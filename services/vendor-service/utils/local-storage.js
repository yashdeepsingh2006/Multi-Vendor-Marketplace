import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { assertObjectKey, buildObjectKey } from "./storage-keys.js";

// The local backend mirrors the S3 object-key layout on disk:
//   <storage>/products/<vendorUserId>/<date>/<uuid>-<filename>
//   <storage>/kyc/<vendorUserId>/<date>/<uuid>-<filename>
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STORAGE_DIRECTORY = path.join(SERVICE_ROOT, "storage");
const DEFAULT_SIGNED_URL_TTL = 900;
const MAX_SIGNED_URL_TTL = 7 * 24 * 60 * 60;

let fallbackUrlSecret = null;

// dotenv.config() runs after module imports are evaluated, so read lazily.
const readEnv = (name) => {
    const value = process.env[name];
    return typeof value === "string" ? value.trim() : "";
};

const getUrlSecret = () => {
    const configured = readEnv("LOCAL_STORAGE_SECRET") || readEnv("JWT_SECRET");
    if (configured) {
        return configured;
    }

    // Local fallback links are only valid for the lifetime of this process when
    // no explicit secret is configured.
    if (!fallbackUrlSecret) {
        fallbackUrlSecret = crypto.randomBytes(32).toString("hex");
    }
    return fallbackUrlSecret;
};

const getStorageDirectory = () => {
    const configured = readEnv("LOCAL_STORAGE_DIR");
    if (!configured) {
        return DEFAULT_STORAGE_DIRECTORY;
    }
    return path.isAbsolute(configured)
        ? path.normalize(configured)
        : path.resolve(SERVICE_ROOT, configured);
};

const getSignedUrlTtl = () => {
    const configured = Number(readEnv("LOCAL_STORAGE_SIGNED_URL_TTL") || readEnv("AWS_S3_SIGNED_URL_TTL"));
    if (!Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_SIGNED_URL_TTL;
    }
    return Math.max(1, Math.min(Math.floor(configured), MAX_SIGNED_URL_TTL));
};

const getConfig = () => ({
    directory: getStorageDirectory(),
    signedUrlTtl: getSignedUrlTtl()
});

const createStorageError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const validateStorageKey = (key) => {
    const value = typeof key === "string" ? key.trim() : "";
    const prefix = value.split("/")[0];

    if (prefix !== "kyc" && prefix !== "products") {
        throw createStorageError(
            'Invalid storage object key. Expected a key starting with "kyc/" or "products/".',
            400
        );
    }

    return assertObjectKey(value, prefix);
};

const getFilePath = (key) => {
    const safeKey = validateStorageKey(key);
    const root = path.resolve(getStorageDirectory());
    const resolved = path.resolve(root, ...safeKey.split("/"));
    const relative = path.relative(root, resolved);

    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw createStorageError("Invalid storage object key", 400);
    }

    return resolved;
};

const contentTypeForPath = (filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".avif": "image/avif"
    };
    return contentTypes[extension] || "application/octet-stream";
};

const uploadFiles = async (files = [], options = {}) => {
    return Promise.all(files.map(async (file) => {
        if (!file || !Buffer.isBuffer(file.buffer)) {
            throw createStorageError("Uploaded file data is missing", 400);
        }

        const key = buildObjectKey(options.prefix, file.originalname);
        const filePath = getFilePath(key);

        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, file.buffer, { flag: "wx" });

        return { key, bucket: "local" };
    }));
};

const deleteFile = async (key) => {
    let filePath;
    try {
        filePath = getFilePath(key);
    } catch {
        return false;
    }

    try {
        await fsp.unlink(filePath);
        return true;
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error(`Failed to delete local file "${key}":`, error.message);
        }
        return false;
    }
};

const getFile = async (key) => {
    const filePath = getFilePath(key);

    let stats;
    try {
        stats = await fsp.stat(filePath);
    } catch (error) {
        if (error.code === "ENOENT") {
            throw createStorageError("Stored file not found", 404);
        }
        throw error;
    }

    if (!stats.isFile()) {
        throw createStorageError("Stored file not found", 404);
    }

    return {
        path: filePath,
        size: stats.size,
        contentType: contentTypeForPath(filePath)
    };
};

const createReadStream = (filePath) => fs.createReadStream(filePath);

const safeCompare = (expected, received) => {
    if (typeof received !== "string" || received.length !== expected.length) {
        return false;
    }
    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");
    return expectedBuffer.length === receivedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const computeDownloadSignature = (key, expiresAt) => (
    crypto
        .createHmac("sha256", getUrlSecret())
        .update(`${key}|${expiresAt}`)
        .digest("hex")
);

const createDownloadUrl = (key, baseUrl, expiresIn) => {
    validateStorageKey(key);

    const requestedTtl = Number(expiresIn);
    const ttl = Number.isFinite(requestedTtl) && requestedTtl > 0
        ? Math.max(1, Math.min(Math.floor(requestedTtl), MAX_SIGNED_URL_TTL))
        : getSignedUrlTtl();
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const signature = computeDownloadSignature(key, expiresAt);
    const params = new URLSearchParams({
        key,
        expires: String(expiresAt),
        signature
    });
    const prefix = String(baseUrl || "").replace(/\/+$/, "");

    return `${prefix}/vendor-data/kyc-file?${params.toString()}`;
};

const verifyDownloadRequest = (key, expires, signature) => {
    if (!key || !signature) {
        return false;
    }

    const expiresAt = Number(expires);
    if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
        return false;
    }
    if (expiresAt * 1000 < Date.now()) {
        return false;
    }

    try {
        validateStorageKey(key);
    } catch {
        return false;
    }

    return safeCompare(computeDownloadSignature(key, expiresAt), signature);
};

export {
    createDownloadUrl,
    createReadStream,
    deleteFile,
    getConfig,
    getFile,
    getStorageDirectory,
    getFilePath,
    uploadFiles,
    verifyDownloadRequest
};

export default {
    createDownloadUrl,
    createReadStream,
    deleteFile,
    getConfig,
    getFile,
    getStorageDirectory,
    getFilePath,
    uploadFiles,
    verifyDownloadRequest
};
