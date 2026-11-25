import { Router } from "express";
import config from "./config.js";
import { createProxy } from "./proxy.js";
import { aggregateHealth } from "./health.js";

const router = Router();

// 1. Health check & Gateway Info
router.get("/health", async (req, res) => {
    const healthReport = await aggregateHealth();
    const statusCode = healthReport.status === "HEALTHY" ? 200 : 207;
    return res.status(statusCode).json(healthReport);
});

router.get("/", (req, res) => {
    res.json({
        name: "Multi-Vendor Marketplace API Gateway",
        status: "RUNNING",
        port: config.port,
        services: config.services,
        routes: [
            { path: "/auth/customer/*", target: "Customer Service (:3002)", description: "Customer OTP auth" },
            { path: "/customers/*", target: "Customer Service (:3002)", description: "Customer profile and saved address book" },
            { path: "/catalog/*", target: "Customer Service (:3002)", description: "Public product catalog" },
            { path: "/cart/*", target: "Customer Service (:3002)", description: "Customer shopping cart" },
            { path: "/orders/*", target: "Order Service (:3003)", description: "Customer checkout and order lifecycle" },
            { path: "/vendor/orders/*", target: "Order Service (:3003)", description: "Vendor sub-orders & fulfillment status" },
            { path: "/vendor-data/orders/*", target: "Order Service (:3003)", description: "Vendor sub-orders & fulfillment status" },
            { path: "/auth/*", target: "Vendor Service (:3001)", description: "Vendor & Admin auth and credentials" },
            { path: "/register/*", target: "Vendor Service (:3001)", description: "Vendor store registration" },
            { path: "/vendor-data/*", target: "Vendor Service (:3001)", description: "Vendor profile & KYC verification" },
            { path: "/products/*", target: "Vendor Service (:3001)", description: "Vendor product catalog management" },
            { path: "/admin/*", target: "Vendor Service (:3001)", description: "Platform admin governance and approvals" },
            { path: "/uploads/*", target: "Vendor Service (:3001)", description: "Static media and product images" },
            { path: "/otp/*", target: "OTP Service (:3000)", description: "Direct OTP generation & verification" },
            { path: "/api/*", target: "Dynamic", description: "Prefix alias for all above routes" }
        ]
    });
});

// Proxies to downstream services
const customerProxy = createProxy(config.services.customer, { serviceName: "Customer Service" });
const orderProxy = createProxy(config.services.order, { serviceName: "Order Service" });
const vendorProxy = createProxy(config.services.vendor, { serviceName: "Vendor Service" });
const otpProxy = createProxy(config.services.otp, { serviceName: "OTP Service" });

// 2. High-priority specific routes
// Customer OTP auth
router.use(["/auth/customer", "/api/auth/customer"], customerProxy);

// Vendor order fulfillment (must be matched before general /vendor-data)
router.use(["/vendor-data/orders", "/api/vendor-data/orders"], orderProxy);
router.use(["/vendor/orders", "/api/vendor/orders"], orderProxy);
router.use(["/orders/vendor", "/api/orders/vendor"], orderProxy);

// 3. Customer Service routes
router.use(["/customers", "/api/customers"], customerProxy);
router.use(["/catalog", "/api/catalog"], customerProxy);
router.use(["/cart", "/api/cart"], customerProxy);

// 4. Order Service routes
router.use(["/orders", "/api/orders"], orderProxy);
router.use(["/customer/orders", "/api/customer/orders"], orderProxy);

// 5. Vendor Service routes
router.use(["/auth", "/api/auth"], vendorProxy);
router.use(["/register", "/api/register"], vendorProxy);
router.use(["/vendor-data", "/api/vendor-data"], vendorProxy);
router.use(["/products", "/api/products"], vendorProxy);
router.use(["/admin", "/api/admin"], vendorProxy);
router.use(["/uploads", "/api/uploads"], vendorProxy);

// 6. OTP Service routes
router.use(["/otp", "/api/otp"], otpProxy);

export default router;

