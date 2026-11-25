import config from "./config.js";

const checkEndpoint = async (url, serviceName) => {
    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(url, {
            signal: controller.signal
        });
        clearTimeout(timeout);

        const latencyMs = Date.now() - startTime;
        return {
            service: serviceName,
            url,
            status: res.ok ? "UP" : "DEGRADED",
            statusCode: res.status,
            latencyMs
        };
    } catch (err) {
        return {
            service: serviceName,
            url,
            status: "DOWN",
            error: err.name === "AbortError" ? "Timeout after 2000ms" : err.message,
            latencyMs: Date.now() - startTime
        };
    }
};

export const aggregateHealth = async () => {
    const [otpHealth, vendorHealth, customerHealth, orderHealth] = await Promise.all([
        checkEndpoint(`${config.services.otp}/`, "OTP Service"),
        checkEndpoint(`${config.services.vendor}/health`, "Vendor Service"),
        checkEndpoint(`${config.services.customer}/health`, "Customer Service"),
        checkEndpoint(`${config.services.order}/health`, "Order Service")
    ]);

    const services = [otpHealth, vendorHealth, customerHealth, orderHealth];
    const allUp = services.every((s) => s.status === "UP");
    const anyDown = services.some((s) => s.status === "DOWN");

    return {
        status: allUp ? "HEALTHY" : anyDown ? "PARTIALLY_DEGRADED" : "HEALTHY",
        gateway: "UP",
        timestamp: new Date().toISOString(),
        services: {
            otpService: otpHealth,
            vendorService: vendorHealth,
            customerService: customerHealth,
            orderService: orderHealth
        }
    };
};

export default aggregateHealth;

