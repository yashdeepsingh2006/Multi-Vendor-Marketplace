import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import config from "../src/config.js";
import { createProxy } from "../src/proxy.js";

test("gateway configuration loads defaults and service URLs", () => {
    assert.ok(config.port, "Port should be defined");
    assert.ok(config.services.otp.includes("3000"));
    assert.ok(config.services.vendor.includes("3001"));
    assert.ok(config.services.customer.includes("3002"));
    assert.ok(config.services.order.includes("3003"));
});

test("createProxy returns an express middleware function", () => {
    const proxyMiddleware = createProxy("http://localhost:3001", { serviceName: "Test Service" });
    assert.equal(typeof proxyMiddleware, "function");
    assert.equal(proxyMiddleware.length, 2); // (req, res)
});

test("createProxy handles unreachable target with structured 503 error", async () => {
    // Port 59999 is guaranteed unreachable locally
    const proxyMiddleware = createProxy("http://127.0.0.1:59999", { serviceName: "Offline Service" });

    let statusCode = 0;
    let jsonBody = null;

    const mockReq = {
        url: "/test-endpoint",
        method: "GET",
        headers: { host: "localhost:8000" },
        pipe: () => {},
        socket: { remoteAddress: "127.0.0.1" }
    };

    const mockRes = {
        headersSent: false,
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            jsonBody = body;
            return this;
        },
        setHeader() {}
    };

    proxyMiddleware(mockReq, mockRes);

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(statusCode, 503);
    assert.ok(jsonBody.message.includes("Offline Service is currently unavailable"));
    assert.equal(jsonBody.service, "Offline Service");
});

test("createProxy sets appropriate gateway headers and passes path rewrite", () => {
    const proxy = createProxy("http://localhost:3002", {
        serviceName: "Customer Service",
        pathRewrite: (p) => p.replace(/^\/api/, "")
    });
    assert.equal(typeof proxy, "function");
});

test("createProxy preserves full resource path from req.originalUrl and strips /api prefix", () => {
    const capturedPaths = [];
    const dummyTransport = {
        request(options) {
            capturedPaths.push(options.path);
            const reqEmitter = new EventEmitter();
            reqEmitter.abort = () => {};
            return reqEmitter;
        }
    };

    const proxy = createProxy("http://localhost:3002", {
        serviceName: "Customer Service",
        transport: dummyTransport
    });

    // Scenario 1: Express stripped /catalog to req.url='/products', but req.originalUrl='/catalog/products?page=1'
    const mockReq1 = {
        originalUrl: "/catalog/products?page=1",
        url: "/products?page=1",
        method: "GET",
        headers: { host: "localhost:8000" },
        pipe: () => {},
        socket: { remoteAddress: "127.0.0.1" }
    };
    const mockRes1 = { status() { return this; }, setHeader() {}, headersSent: false };

    // Scenario 2: Prefixed route /api/catalog/products
    const mockReq2 = {
        originalUrl: "/api/catalog/products?page=2",
        url: "/catalog/products?page=2",
        method: "GET",
        headers: { host: "localhost:8000" },
        pipe: () => {},
        socket: { remoteAddress: "127.0.0.1" }
    };
    const mockRes2 = { status() { return this; }, setHeader() {}, headersSent: false };

    proxy(mockReq1, mockRes1);
    proxy(mockReq2, mockRes2);

    assert.equal(capturedPaths.length, 2);
    assert.equal(capturedPaths[0], "/catalog/products?page=1", "Should forward /catalog/products from req.originalUrl");
    assert.equal(capturedPaths[1], "/catalog/products?page=2", "Should strip /api and forward /catalog/products");
});
