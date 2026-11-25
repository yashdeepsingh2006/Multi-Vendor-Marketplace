import dotenv from "dotenv";

dotenv.config();

export const config = {
    port: process.env.PORT || 8000,
    corsOrigin: process.env.CORS_ORIGIN || "*",
    services: {
        otp: (process.env.OTP_SERVICE_URL || "http://localhost:3000").replace(/\/+$/, ""),
        vendor: (process.env.VENDOR_SERVICE_URL || "http://localhost:3001").replace(/\/+$/, ""),
        customer: (process.env.CUSTOMER_SERVICE_URL || "http://localhost:3002").replace(/\/+$/, ""),
        order: (process.env.ORDER_SERVICE_URL || "http://localhost:3003").replace(/\/+$/, "")
    }
};

export default config;

