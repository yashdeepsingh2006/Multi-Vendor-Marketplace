import {
    deleteFileFromS3,
    getDownloadUrl as getS3DownloadUrl,
    getProductImageUrl as getS3ProductImageUrl,
    getPublicObjectUrl,
    getS3Config,
    isS3Configured as isS3BackendConfigured,
    uploadFilesToS3
} from "./s3.js";
import * as local from "./local-storage.js";
import {
    assertObjectKey,
    buildObjectKey,
    encodeKey,
    isKycObjectKey,
    isProductImageObjectKey
} from "./storage-keys.js";

// S3 is used only when a bucket and explicit credentials are present. Otherwise
// uploads fall back to the local filesystem, which keeps development working
// without cloud credentials.
const isS3Configured = () => isS3BackendConfigured();

const getStorageDriver = () => (isS3Configured() ? "s3" : "local");

const isLocalStorage = () => getStorageDriver() === "local";

const getStorageConfig = () => {
    if (getStorageDriver() === "s3") {
        const { signedUrlTtl, publicBaseUrl } = getS3Config();
        return { driver: "s3", signedUrlTtl, publicBaseUrl };
    }

    const { signedUrlTtl, directory } = local.getConfig();
    return { driver: "local", signedUrlTtl, directory, publicBaseUrl: "" };
};

const uploadFiles = async (files = [], options = {}) => {
    if (getStorageDriver() === "s3") {
        return uploadFilesToS3(files, options);
    }
    return local.uploadFiles(files, options);
};

const deleteFile = async (key) => {
    if (getStorageDriver() === "s3") {
        return deleteFileFromS3(key);
    }
    return local.deleteFile(key);
};

const getProductImageUrl = (key) => {
    if (getStorageDriver() === "s3") {
        return getS3ProductImageUrl(key);
    }
    return `/products/images?key=${encodeURIComponent(key)}`;
};

const getDownloadUrl = async (key, options = {}) => {
    const normalized = typeof options === "number" ? { expiresIn: options } : (options || {});

    if (getStorageDriver() === "s3") {
        return getS3DownloadUrl(key, normalized.expiresIn);
    }

    return local.createDownloadUrl(key, normalized.baseUrl, normalized.expiresIn);
};

const getLocalFile = (key) => local.getFile(key);
const createLocalReadStream = (filePath) => local.createReadStream(filePath);
const verifyDownloadRequest = (key, expires, signature) => (
    local.verifyDownloadRequest(key, expires, signature)
);

export {
    assertObjectKey,
    buildObjectKey,
    createLocalReadStream,
    deleteFile,
    encodeKey,
    getDownloadUrl,
    getLocalFile,
    getProductImageUrl,
    getPublicObjectUrl,
    getStorageConfig,
    getStorageDriver,
    isKycObjectKey,
    isLocalStorage,
    isProductImageObjectKey,
    isS3Configured,
    uploadFiles,
    verifyDownloadRequest
};

export default {
    assertObjectKey,
    buildObjectKey,
    createLocalReadStream,
    deleteFile,
    encodeKey,
    getDownloadUrl,
    getLocalFile,
    getProductImageUrl,
    getPublicObjectUrl,
    getStorageConfig,
    getStorageDriver,
    isKycObjectKey,
    isLocalStorage,
    isProductImageObjectKey,
    isS3Configured,
    uploadFiles,
    verifyDownloadRequest
};
