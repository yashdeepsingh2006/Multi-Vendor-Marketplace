import express from "express";
import cors from "cors";
import config from "./config.js";
import routes from "./routes.js";

const app = express();

const configuredOrigin = config.corsOrigin;
const originSetting = !configuredOrigin || configuredOrigin === "*" || configuredOrigin === "true"
    ? true
    : (configuredOrigin.includes(",") ? configuredOrigin.split(",").map(o => o.trim()) : configuredOrigin);

const corsOptions = {
    origin: originSetting,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Lightweight request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[Gateway] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Mount application and proxy routes
app.use(routes);

// Global 404 handler for unrecognized gateway routes
app.use((req, res) => {
    res.status(404).json({
        message: `Route '${req.method} ${req.originalUrl}' not recognized by API Gateway`,
        availableEndpoints: "/ for route map, /health for service status"
    });
});

if (process.env.NODE_ENV !== "test") {
    app.listen(config.port, () => {
        console.log(`====================================================`);
        console.log(`🚀 API Gateway active on http://localhost:${config.port}`);
        console.log(`   • OTP Service:      ${config.services.otp}`);
        console.log(`   • Vendor Service:   ${config.services.vendor}`);
        console.log(`   • Customer Service: ${config.services.customer}`);
        console.log(`   • Order Service:    ${config.services.order}`);
        console.log(`====================================================`);
    });
}

export default app;

