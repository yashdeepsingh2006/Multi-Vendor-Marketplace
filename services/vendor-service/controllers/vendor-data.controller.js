import path from "path";
import { getVendor, updateVendorProfile } from "../services/vendor-data.service.js";
import { serializeVendorPublic, serializeVendorSelf } from "../utils/vendor.serialization.js";
import {
    createLocalReadStream,
    deleteFile,
    getDownloadUrl,
    getLocalFile,
    getStorageConfig,
    isKycObjectKey,
    isLocalStorage,
    uploadFiles,
    verifyDownloadRequest
} from "../utils/storage.js";

const firstHeaderValue = (value) => String(value || "").split(",")[0].trim();

const getRequestBaseUrl = (req) => {
    const forwardedProto = firstHeaderValue(req.headers?.["x-forwarded-proto"]);
    const forwardedHost = firstHeaderValue(req.headers?.["x-forwarded-host"]);
    const protocol = forwardedProto || req.protocol || "http";
    const host = forwardedHost || req.get?.("host") || req.headers?.host;

    return host ? `${protocol}://${host}` : "";
};

const vendorDataController = async (req, res) => {
    try {
        const userId = req.params?.userId || req.query?.userId || req.user?.userId;
        const uuid = req.query?.uuid;

        if (!userId && !uuid) {
            return res.status(400).json({
                message: "userId parameter is required to fetch vendor data"
            });
        }

        const vendorData = await getVendor(uuid, userId);

        if (!vendorData) {
            return res.status(404).json({
                message: "Vendor not found"
            });
        }

        // Non-admin vendors are only permitted to access their own vendor record
        if (req.user && req.user.role !== "admin" && Number(vendorData.userId) !== Number(req.user.userId)) {
            return res.status(403).json({
                message: "Forbidden: You are only allowed to access your own vendor data"
            });
        }

        const isOwnerOrAdmin = req.user && (req.user.role === "admin" || Number(vendorData.userId) === Number(req.user.userId));
        const payload = isOwnerOrAdmin ? serializeVendorSelf(vendorData) : serializeVendorPublic(vendorData);

        return res.status(200).json({
            message: "Vendor data fetched successfully",
            data: payload
        });
    } catch (error) {
        console.error("Error in vendorDataController:", error);
        return res.status(500).json({
            message: "Internal server error while fetching vendor data"
        });
    }
};

const updateVendorController = async (req, res) => {
    try {
        const targetUserId = req.params?.userId || req.user?.userId;

        if (!targetUserId) {
            return res.status(400).json({ message: "userId is required" });
        }

        // Non-admin vendors can only update their own profile
        if (req.user && req.user.role !== "admin" && Number(targetUserId) !== Number(req.user.userId)) {
            return res.status(403).json({
                message: "Forbidden: You can only update your own vendor profile"
            });
        }

        const { storeName, slug, payoutAccountId, kycDocs } = req.body || {};

        // Determine KYC objects that are being removed so they can be cleaned up
        // after the metadata update succeeds.
        let removedKycKeys = [];
        if (Array.isArray(kycDocs)) {
            const existingVendor = await getVendor(null, targetUserId);
            if (existingVendor) {
                const retainedDocs = new Set(kycDocs);
                removedKycKeys = (existingVendor.kycDocs || [])
                    .filter((doc) => !retainedDocs.has(doc) && isKycObjectKey(doc));
            }
        }

        const result = await updateVendorProfile(targetUserId, {
            storeName,
            slug,
            payoutAccountId,
            kycDocs
        });

        await Promise.all(removedKycKeys.map((key) => deleteFile(key)));

        return res.status(result.statusCode || 200).json(result);
    } catch (error) {
        console.error("Error in updateVendorController:", error);
        return res.status(error.statusCode || 500).json({
            message: error.message || "Internal server error updating vendor profile"
        });
    }
};

const uploadKycController = async (req, res) => {
    try {
        const files = req.files && req.files.length > 0
            ? req.files
            : req.file ? [req.file] : [];

        if (files.length === 0) {
            return res.status(400).json({ message: "No document file was uploaded" });
        }

        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Authentication required to upload KYC documents" });
        }

        // Fetch the vendor before uploading so missing profiles do not leave orphaned objects.
        const vendor = await getVendor(null, userId);
        if (!vendor) {
            return res.status(404).json({ message: "Vendor profile not found" });
        }

        const uploadedFiles = await uploadFiles(files, {
            prefix: `kyc/${userId}`,
            cacheControl: "private, max-age=0, no-store"
        });
        const uploadedKeys = uploadedFiles.map((file) => file.key);

        const updatedKycDocs = Array.from(new Set([...(vendor.kycDocs || []), ...uploadedKeys]));
        const result = await updateVendorProfile(userId, { kycDocs: updatedKycDocs });

        return res.status(200).json({
            message: "KYC document uploaded successfully",
            files: uploadedKeys,
            data: result.data
        });
    } catch (error) {
        console.error("Error in uploadKycController:", error);
        return res.status(error.statusCode || 500).json({
            message: error.message || "Failed to upload KYC document"
        });
    }
};

const getKycDownloadUrlController = async (req, res) => {
    try {
        const key = req.query?.key;

        if (!isKycObjectKey(key)) {
            return res.status(400).json({ message: "A valid KYC document key is required" });
        }

        const isAdmin = req.user?.role === "admin";
        let targetUserId = req.user?.userId;

        if (isAdmin && req.query?.userId !== undefined && req.query.userId !== "") {
            targetUserId = Number(req.query.userId);
            if (!Number.isInteger(targetUserId)) {
                return res.status(400).json({ message: "userId must be a valid user identifier" });
            }
        }

        if (targetUserId === undefined || targetUserId === null) {
            return res.status(401).json({ message: "Authenticated user identity is required" });
        }

        // Vendor-owned keys are namespaced by user id; only admins may read other vendors' documents.
        if (!isAdmin && !key.startsWith(`kyc/${targetUserId}/`)) {
            return res.status(403).json({ message: "Forbidden: You can only access your own KYC documents" });
        }

        const vendor = await getVendor(null, targetUserId);
        if (!vendor) {
            return res.status(404).json({ message: "Vendor profile not found" });
        }

        if (!isAdmin && !(vendor.kycDocs || []).includes(key)) {
            return res.status(404).json({ message: "KYC document not found for this vendor" });
        }

        const { signedUrlTtl } = getStorageConfig();
        const url = await getDownloadUrl(key, {
            baseUrl: getRequestBaseUrl(req),
            expiresIn: signedUrlTtl
        });

        return res.status(200).json({
            message: "KYC document URL generated successfully",
            data: {
                url,
                expiresIn: signedUrlTtl
            }
        });
    } catch (error) {
        console.error("Error in getKycDownloadUrlController:", error);
        return res.status(error.statusCode || 500).json({
            message: error.message || "Failed to generate KYC document URL"
        });
    }
};

// Serves locally stored KYC documents through a short-lived HMAC-signed link.
// This route is public because browsers open the generated URL in a new tab
// without the Authorization header; the signature and expiry protect the file.
const getKycDocumentController = async (req, res) => {
    try {
        if (!isLocalStorage()) {
            return res.status(404).json({ message: "KYC document is not available through this endpoint" });
        }

        const key = req.query?.key;
        const expires = req.query?.expires;
        const signature = req.query?.signature;

        if (!isKycObjectKey(key)) {
            return res.status(400).json({ message: "A valid KYC document key is required" });
        }

        if (!verifyDownloadRequest(key, expires, signature)) {
            return res.status(403).json({ message: "KYC download link is invalid or has expired" });
        }

        const file = await getLocalFile(key);
        const fileName = path.basename(file.path).replace(/["\\\r\n]/g, "");

        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Content-Length", String(file.size));
        res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");

        const stream = createLocalReadStream(file.path);
        stream.on("error", () => res.destroy());
        return stream.pipe(res);
    } catch (error) {
        console.error("Error in getKycDocumentController:", error);
        return res.status(error.statusCode || 500).json({
            message: error.message || "Failed to open KYC document"
        });
    }
};

export {
    vendorDataController,
    updateVendorController,
    uploadKycController,
    getKycDownloadUrlController,
    getKycDocumentController
};
export default {
    vendorDataController,
    updateVendorController,
    uploadKycController,
    getKycDownloadUrlController,
    getKycDocumentController
};
