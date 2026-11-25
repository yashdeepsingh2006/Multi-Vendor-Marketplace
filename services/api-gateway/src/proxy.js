import http from "http";
import https from "https";
import crypto from "crypto";

/**
 * Creates a streaming reverse-proxy middleware that forwards requests to targetBaseUrl
 * @param {string} targetBaseUrl - The target microservice base URL (e.g. "http://localhost:3001")
 * @param {object} [options]
 * @param {string} [options.serviceName] - Human-readable microservice name for logging & error messages
 * @param {(reqPath: string) => string} [options.pathRewrite] - Optional function to rewrite request path
 */
export const createProxy = (targetBaseUrl, options = {}) => {
    const { serviceName = "Microservice", pathRewrite = (p) => p, transport: customTransport } = options;
    const targetUrlObj = new URL(targetBaseUrl);
    const isHttps = targetUrlObj.protocol === "https:";
    const transport = customTransport || (isHttps ? https : http);

    return (req, res) => {
        const requestId = req.headers["x-request-id"] || `req-${crypto.randomUUID()}`;

        // In Express, req.url inside a mounted router only contains the subpath.
        // We use req.originalUrl to preserve the full resource path (e.g. /catalog/products?page=1),
        // and strip any leading /api prefix so downstream services receive canonical resource routes.
        let rawPath = req.originalUrl || req.url || "/";
        if (rawPath.startsWith("/api/")) {
            rawPath = rawPath.slice(4);
        } else if (rawPath === "/api") {
            rawPath = "/";
        }
        if (!rawPath.startsWith("/")) {
            rawPath = `/${rawPath}`;
        }

        const targetPath = pathRewrite(rawPath);
        const targetUrl = new URL(targetPath, targetBaseUrl);

        const forwardHeaders = { ...req.headers };
        forwardHeaders["host"] = targetUrlObj.host;
        forwardHeaders["x-request-id"] = requestId;
        forwardHeaders["x-forwarded-for"] = req.ip || req.socket.remoteAddress || "127.0.0.1";
        forwardHeaders["x-forwarded-host"] = req.headers["host"] || "localhost";
        forwardHeaders["x-forwarded-proto"] = req.protocol || "http";

        const requestOptions = {
            hostname: targetUrlObj.hostname,
            port: targetUrlObj.port || (isHttps ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: forwardHeaders
        };

        const proxyReq = transport.request(requestOptions, (proxyRes) => {
            res.status(proxyRes.statusCode);

            for (const [key, value] of Object.entries(proxyRes.headers)) {
                if (key.toLowerCase() !== "transfer-encoding") {
                    res.setHeader(key, value);
                }
            }
            res.setHeader("x-gateway-service", serviceName);
            res.setHeader("x-request-id", requestId);

            proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
            console.error(`[API Gateway] Error proxying to ${serviceName} (${targetBaseUrl}):`, err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    message: `${serviceName} is currently unavailable. Please verify the service is running.`,
                    service: serviceName,
                    target: targetBaseUrl,
                    requestId,
                    error: err.code || err.message
                });
            }
        });

        // Stream the incoming client request body into the proxy request
        req.pipe(proxyReq);
    };
};

export default createProxy;

