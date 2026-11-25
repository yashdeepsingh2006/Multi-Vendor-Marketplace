import crypto from "crypto";
import path from "path";
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// dotenv.config() runs in src/index.js after module imports are evaluated, so
// configuration is intentionally read lazily on every call instead of at import time.
const readEnv = (name) => {
    const value = process.env[name];
    return typeof value === "string" ? value.trim() : "";
};

const getConfig = () => {
    const region = readEnv("AWS_REGION") || readEnv("AWS_DEFAULT_REGION") || "us-east-1";
    const bucket = readEnv("AWS_S3_BUCKET");
    const endpoint = readEnv("AWS_S3_ENDPOINT").replace(/\/+$/, "");
    const publicBaseUrl = readEnv("AWS_S3_PUBLIC_BASE_URL").replace(/\/+$/, "");
    const accessKeyId = readEnv("AWS_ACCESS_KEY_ID");
    const secretAccessKey = readEnv("AWS_SECRET_ACCESS_KEY");
    const sessionToken = readEnv("AWS_SESSION_TOKEN");
    const forcePathStyle = readEnv("AWS_S3_FORCE_PATH_STYLE").toLowerCase() === "true";
    const signedUrlTtl = Number(readEnv("AWS_S3_SIGNED_URL_TTL")) || 900; // 15 minutes

    return {
        region,
        bucket,
        endpoint,
        publicBaseUrl,
        accessKeyId,
        secretAccessKey,
        sessionToken,
        forcePathStyle,
        signedUrlTtl
    };
};

let cachedClient = null;
let cachedClientSignature = "";

const getClient = () => {
    const config = getConfig();
    // Recreate the client if the configuration changes (useful for tests and hot reloads).
    const signature = [
        config.region,
        config.endpoint,
        config.accessKeyId,
        config.secretAccessKey,
        config.sessionToken,
        String(config.forcePathStyle)
    ].join("|");

    if (!cachedClient || signature !== cachedClientSignature) {
        const clientConfig = {
            region: config.region,
            forcePathStyle: config.forcePathStyle
        };

        if (config.endpoint) {
            clientConfig.endpoint = config.endpoint;
        }

        if (config.accessKeyId && config.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
                ...(config.sessionToken ? { sessionToken: config.sessionToken } : {})
            };
        }

        cachedClient = new S3Client(clientConfig);
        cachedClientSignature = signature;
    }

    return cachedClient;
};

const requireBucket = () => {
    const { bucket } = getConfig();
    if (!bucket) {
        const error = new Error(
            "Amazon S3 is not configured. Set AWS_S3_BUCKET (plus AWS_REGION and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) before uploading files."
        );
        error.statusCode = 500;
        throw error;
    }
    return bucket;
};

const normalizePrefix = (prefix) => {
    const cleaned = String(prefix || "uploads")
        .replace(/^\/+|\/+$/g, "")
        .replace(/[^a-zA-Z0-9/_-]+/g, "_");

    return cleaned || "uploads";
};

const safeFileName = (originalName) => {
    const extension = path.extname(originalName || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
    const base = path
        .basename(originalName || "file", path.extname(originalName || ""))
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "file";

    return `${base}${extension}`;
};

const buildObjectKey = (prefix, originalName) => {
    const date = new Date().toISOString().slice(0, 10);
    return `${normalizePrefix(prefix)}/${date}/${crypto.randomUUID()}-${safeFileName(originalName)}`;
};

const encodeKey = (key) => String(key).split("/").map(encodeURIComponent).join("/");

const getPublicObjectUrl = (key) => {
    const { bucket, region, endpoint, publicBaseUrl, forcePathStyle } = getConfig();

    if (publicBaseUrl) {
        return `${publicBaseUrl}/${encodeKey(key)}`;
    }

    if (endpoint) {
        if (forcePathStyle) {
            return `${endpoint}/${bucket}/${encodeKey(key)}`;
        }
        const parsed = new URL(endpoint);
        return `${parsed.protocol}//${bucket}.${parsed.host}/${encodeKey(key)}`;
    }

    return `https://${bucket}.s3.${region}.amazonaws.com/${encodeKey(key)}`;
};

/**
 * Returns the durable URL persisted in the database for a product image.
 * When AWS_S3_PUBLIC_BASE_URL is configured (for example a CloudFront domain)
 * the direct public URL is used; otherwise the vendor service proxies the
 * private object through /products/images?key=...
 */
const getProductImageUrl = (key) => {
    const { publicBaseUrl } = getConfig();
    if (publicBaseUrl) {
        return getPublicObjectUrl(key);
    }
    return `/products/images?key=${encodeURIComponent(key)}`;
};

const assertObjectKey = (key, prefix) => {
    const value = typeof key === "string" ? key.trim() : "";
    if (!value || value.length > 1024 || value.includes("..") || !value.startsWith(`${prefix}/`)) {
        const error = new Error(`Invalid S3 object key. Expected a key starting with "${prefix}/".`);
        error.statusCode = 400;
        throw error;
    }
    return value;
};

const isKycObjectKey = (key) => {
    try {
        assertObjectKey(key, "kyc");
        return true;
    } catch {
        return false;
    }
};

const isProductImageObjectKey = (key) => {
    try {
        assertObjectKey(key, "products");
        return true;
    } catch {
        return false;
    }
};

const uploadFileToS3 = async (file, options = {}) => {
    const bucket = requireBucket();
    const key = buildObjectKey(options.prefix, file.originalname);

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || "application/octet-stream",
        CacheControl: options.cacheControl || "private, no-store",
        ...(options.acl ? { ACL: options.acl } : {})
    });

    await getClient().send(command);
    return { key, bucket };
};

const uploadFilesToS3 = async (files = [], options = {}) => {
    requireBucket();
    return Promise.all(files.map((file) => uploadFileToS3(file, options)));
};

const getDownloadUrl = async (key, expiresIn) => {
    const bucket = requireBucket();
    const ttl = Number(expiresIn) || getConfig().signedUrlTtl;
    const boundedTtl = Math.max(1, Math.min(Math.floor(ttl), 7 * 24 * 60 * 60));

    return getSignedUrl(
        getClient(),
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseContentDisposition: "inline"
        }),
        { expiresIn: boundedTtl }
    );
};

const deleteFileFromS3 = async (key) => {
    if (!getConfig().bucket || !key) {
        return false;
    }

    try {
        await getClient().send(new DeleteObjectCommand({
            Bucket: getConfig().bucket,
            Key: key
        }));
        return true;
    } catch (error) {
        // Deleting the storage object is best effort: metadata removal must not fail.
        console.error(`Failed to delete S3 object "${key}":`, error.message);
        return false;
    }
};

const isS3Configured = () => Boolean(getConfig().bucket);

export {
    buildObjectKey,
    deleteFileFromS3,
    getClient,
    getConfig as getS3Config,
    getDownloadUrl,
    getProductImageUrl,
    getPublicObjectUrl,
    isKycObjectKey,
    isProductImageObjectKey,
    isS3Configured,
    requireBucket,
    uploadFilesToS3
};

export default {
    buildObjectKey,
    deleteFileFromS3,
    getDownloadUrl,
    getProductImageUrl,
    getPublicObjectUrl,
    isKycObjectKey,
    isProductImageObjectKey,
    isS3Configured,
    uploadFilesToS3
};
