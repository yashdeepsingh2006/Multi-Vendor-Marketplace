import crypto from "crypto";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 15000;

const createHttpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const requireEnv = (name) => {
    const value = (process.env[name] || "").trim();
    if (!value) {
        throw createHttpError(`Razorpay is not configured: ${name} is missing`, 503);
    }
    return value;
};

const safeCompare = (expected, received) => {
    if (typeof received !== "string" || received.length !== expected.length) {
        return false;
    }
    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");
    if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const validateMinorAmount = (amountMinor) => {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw createHttpError("Payment amount must be a positive integer in minor units", 400);
    }
};

export const getRazorpayCredentials = () => ({
    keyId: requireEnv("RAZORPAY_KEY_ID"),
    keySecret: requireEnv("RAZORPAY_KEY_SECRET")
});

export const getRazorpayKeyId = () => requireEnv("RAZORPAY_KEY_ID");

export const getRazorpayWebhookSecret = () => requireEnv("RAZORPAY_WEBHOOK_SECRET");

export const buildRazorpayOrderPayload = ({ amountMinor, currency, receipt, notes }) => {
    validateMinorAmount(amountMinor);

    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
        throw createHttpError("Payment currency must be a 3-letter ISO code", 400);
    }

    if (typeof receipt !== "string" || !receipt.trim() || receipt.trim().length > 40) {
        throw createHttpError("Razorpay receipt must be a non-empty string of at most 40 characters", 400);
    }

    const payload = {
        amount: amountMinor,
        currency,
        receipt: receipt.trim()
    };

    if (notes && typeof notes === "object" && !Array.isArray(notes)) {
        payload.notes = Object.fromEntries(
            Object.entries(notes)
                .filter(([, value]) => value !== undefined && value !== null)
                .map(([key, value]) => [key, String(value).slice(0, 256)])
        );
    }

    return payload;
};

const razorpayRequest = async (path, { method = "GET", body } = {}) => {
    const { keyId, keySecret } = getRazorpayCredentials();
    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    let response;
    try {
        response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
            method,
            headers: {
                Authorization: `Basic ${authorization}`,
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        throw createHttpError(`Razorpay request failed: ${error.message}`, 502);
    }

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const description = data?.error?.description
            || data?.error?.reason
            || `HTTP ${response.status}`;
        const error = createHttpError(`Razorpay request failed: ${description}`, 502);
        error.razorpayStatus = response.status;
        throw error;
    }

    return data;
};

export const createRazorpayOrder = async ({ amountMinor, currency, receipt, notes }) => {
    const payload = buildRazorpayOrderPayload({ amountMinor, currency, receipt, notes });
    const order = await razorpayRequest("/orders", { method: "POST", body: payload });

    if (!order || typeof order.id !== "string" || !order.id) {
        throw createHttpError("Razorpay did not return a valid order", 502);
    }

    return order;
};

export const fetchRazorpayPayment = async (paymentId) => {
    if (typeof paymentId !== "string" || !paymentId.trim()) {
        throw createHttpError("razorpayPaymentId is required", 400);
    }
    return razorpayRequest(`/payments/${encodeURIComponent(paymentId.trim())}`);
};

export const fetchRazorpayOrder = async (razorpayOrderId) => {
    if (typeof razorpayOrderId !== "string" || !razorpayOrderId.trim()) {
        throw createHttpError("razorpayOrderId is required", 400);
    }
    return razorpayRequest(`/orders/${encodeURIComponent(razorpayOrderId.trim())}`);
};

export const listRazorpayOrderPayments = async (razorpayOrderId) => {
    if (typeof razorpayOrderId !== "string" || !razorpayOrderId.trim()) {
        throw createHttpError("razorpayOrderId is required", 400);
    }
    return razorpayRequest(`/orders/${encodeURIComponent(razorpayOrderId.trim())}/payments`);
};

export const captureRazorpayPayment = async (paymentId, { amountMinor, currency }) => {
    validateMinorAmount(amountMinor);
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
        throw createHttpError("Payment currency must be a 3-letter ISO code", 400);
    }
    return razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
        method: "POST",
        body: { amount: amountMinor, currency }
    });
};

export const computePaymentSignature = (razorpayOrderId, razorpayPaymentId, keySecret) => (
    crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex")
);

export const verifyPaymentSignature = (
    { razorpayOrderId, razorpayPaymentId, razorpaySignature },
    keySecret
) => {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !keySecret) {
        return false;
    }
    const expected = computePaymentSignature(razorpayOrderId, razorpayPaymentId, keySecret);
    return safeCompare(expected, razorpaySignature);
};

export const computeWebhookSignature = (rawBody, webhookSecret) => {
    const body = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(String(rawBody ?? ""), "utf8");
    return crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
};

export const verifyWebhookSignature = (rawBody, signature, webhookSecret) => {
    if (!rawBody || !signature || !webhookSecret) {
        return false;
    }
    const expected = computeWebhookSignature(rawBody, webhookSecret);
    return safeCompare(expected, signature);
};

export default {
    buildRazorpayOrderPayload,
    captureRazorpayPayment,
    computePaymentSignature,
    computeWebhookSignature,
    createRazorpayOrder,
    fetchRazorpayOrder,
    fetchRazorpayPayment,
    getRazorpayCredentials,
    getRazorpayKeyId,
    getRazorpayWebhookSecret,
    listRazorpayOrderPayments,
    verifyPaymentSignature,
    verifyWebhookSignature
};
