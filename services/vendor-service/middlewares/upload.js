import multer from "multer";
import path from "path";

// Files are buffered in memory and written to S3 or local storage by the
// controllers. Multer itself does not touch the filesystem.
const storage = multer.memoryStorage();

export const uploadKyc = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /pdf|jpg|jpeg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === "application/pdf";
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Only PDF, JPG, JPEG, PNG, and WebP files are allowed for KYC"));
    }
});

export const uploadProductImages = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png|webp|gif|avif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || (file.mimetype && file.mimetype.startsWith("image/"));
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Only image files (JPG, JPEG, PNG, WebP, GIF, AVIF) are allowed for products"));
    }
});

export default { uploadKyc, uploadProductImages };
