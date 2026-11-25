import crypto from "crypto";
import path from "path";

// Object keys are shared by the S3 and local storage backends so a stored key
// can be resolved without recording which backend produced it.
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

const assertObjectKey = (key, prefix) => {
    const value = typeof key === "string" ? key.trim() : "";
    const valid = Boolean(value)
        && value.length <= 1024
        && !value.includes("..")
        && !value.includes("\\")
        && !value.includes("\0")
        && value.startsWith(`${prefix}/`);

    if (!valid) {
        const error = new Error(`Invalid storage object key. Expected a key starting with "${prefix}/".`);
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

export {
    assertObjectKey,
    buildObjectKey,
    encodeKey,
    isKycObjectKey,
    isProductImageObjectKey
};

export default {
    assertObjectKey,
    buildObjectKey,
    encodeKey,
    isKycObjectKey,
    isProductImageObjectKey
};
