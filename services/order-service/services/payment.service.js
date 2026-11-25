import { Order } from "../utils/db.js";
import { validateOrderId } from "../utils/order.validation.js";
import {
    captureRazorpayPayment,
    createRazorpayOrder,
    fetchRazorpayOrder,
    fetchRazorpayPayment,
    getRazorpayCredentials,
    getRazorpayWebhookSecret,
    listRazorpayOrderPayments,
    verifyPaymentSignature,
    verifyWebhookSignature
} from "../utils/razorpay.js";
import { serializeOrder } from "./order.service.js";

const createHttpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const normalizeString = (value, field, maxLength = 255) => {
    if (typeof value !== "string" || !value.trim()) {
        throw createHttpError(`${field} is required`, 400);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        throw createHttpError(`${field} is too long`, 400);
    }
    return trimmed;
};

const findCustomerOrder = async (customerUserId, orderId) => {
    validateOrderId(orderId);
    const order = await Order.findOne({
        orderId,
        customerUserId: Number(customerUserId)
    });
    if (!order) {
        throw createHttpError("Order not found", 404);
    }
    return order;
};

const toPaymentDate = (unixSeconds) => {
    if (Number.isInteger(unixSeconds) && unixSeconds > 0) {
        return new Date(unixSeconds * 1000);
    }
    return new Date();
};

const confirmPayment = async (order, { razorpayPaymentId, amountMinor, paidAt }) => {
    await Order.updateOne(
        { orderId: order.orderId, paymentStatus: { $ne: "paid" } },
        {
            $set: {
                paymentStatus: "paid",
                paymentProvider: "razorpay",
                razorpayPaymentId,
                paidAmountMinor: Number.isInteger(amountMinor) ? amountMinor : order.totalMinor,
                paidAt: paidAt || new Date(),
                paymentFailureReason: null
            }
        }
    );

    await Order.updateOne(
        { orderId: order.orderId, status: "pending" },
        { $set: { status: "processing" } }
    );

    return Order.findOne({ orderId: order.orderId }).lean();
};

const buildCheckoutPrefill = (order, customer) => {
    const prefill = {};
    if (order.deliveryAddress?.recipientName) {
        prefill.name = order.deliveryAddress.recipientName;
    }
    if (order.deliveryAddress?.phone) {
        prefill.contact = order.deliveryAddress.phone;
    }
    if (typeof customer?.email === "string" && customer.email.trim()) {
        prefill.email = customer.email.trim();
    }
    return prefill;
};

const reconcileExistingRazorpayOrder = async (order) => {
    if (!order.razorpayOrderId) {
        return null;
    }

    let razorpayOrder;
    try {
        razorpayOrder = await fetchRazorpayOrder(order.razorpayOrderId);
    } catch (error) {
        console.warn(
            "[order-service] Could not check the existing Razorpay order:",
            error.message
        );
        return null;
    }

    if (razorpayOrder?.status !== "paid") {
        return null;
    }

    let payments = [];
    try {
        const collection = await listRazorpayOrderPayments(order.razorpayOrderId);
        payments = Array.isArray(collection?.items) ? collection.items : [];
    } catch (error) {
        console.warn(
            "[order-service] Razorpay order is paid but its payments could not be listed:",
            error.message
        );
    }

    const captured = payments.find((payment) => (
        payment?.id &&
        payment.status === "captured" &&
        (!Number.isInteger(payment.amount) || payment.amount === order.totalMinor)
    ));

    if (!captured) {
        throw createHttpError(
            "Razorpay reports this order as paid, but the payment is still being confirmed. Refresh the order in a moment.",
            409
        );
    }

    return confirmPayment(order, {
        razorpayPaymentId: captured.id,
        amountMinor: order.totalMinor,
        paidAt: toPaymentDate(captured.created_at)
    });
};

export const createPaymentSession = async (customerUserId, orderId, customer = {}) => {
    const order = await findCustomerOrder(customerUserId, orderId);

    if (order.paymentStatus === "paid") {
        return {
            alreadyPaid: true,
            order: serializeOrder(order),
            payment: null
        };
    }

    if (order.status !== "pending") {
        throw createHttpError("Only pending orders can be paid", 409);
    }

    if (order.paymentStatus === "refunded") {
        throw createHttpError("This order has been refunded and cannot be paid again", 409);
    }

    if (!Number.isInteger(order.totalMinor) || order.totalMinor <= 0) {
        throw createHttpError("This order has no payable amount", 409);
    }

    // A previous attempt may have been charged after the browser lost the
    // verification response. Reconcile against Razorpay before offering another
    // payment so the customer is never charged twice.
    const reconciled = await reconcileExistingRazorpayOrder(order);
    if (reconciled) {
        return {
            alreadyPaid: true,
            order: serializeOrder(reconciled),
            payment: null
        };
    }

    if (!order.razorpayOrderId) {
        const razorpayOrder = await createRazorpayOrder({
            amountMinor: order.totalMinor,
            currency: order.currency,
            receipt: order.orderId,
            notes: {
                orderId: order.orderId,
                customerUserId: order.customerUserId
            }
        });

        order.paymentProvider = "razorpay";
        order.razorpayOrderId = razorpayOrder.id;
        order.paymentStatus = "pending";
        order.paymentFailureReason = null;
        await order.save();
    }

    const { keyId } = getRazorpayCredentials();

    return {
        alreadyPaid: false,
        order: serializeOrder(order),
        payment: {
            provider: "razorpay",
            keyId,
            razorpayOrderId: order.razorpayOrderId,
            amount: order.totalMinor,
            currency: order.currency,
            name: (process.env.RAZORPAY_CHECKOUT_NAME || "Atelier Objects").trim() || "Atelier Objects",
            description: `Order ${order.orderId}`,
            prefill: buildCheckoutPrefill(order, customer)
        }
    };
};

export const verifyOrderPayment = async (customerUserId, orderId, payload = {}) => {
    const razorpayOrderId = normalizeString(payload.razorpayOrderId, "razorpayOrderId", 100);
    const razorpayPaymentId = normalizeString(payload.razorpayPaymentId, "razorpayPaymentId", 100);
    const razorpaySignature = normalizeString(payload.razorpaySignature, "razorpaySignature", 255);

    const order = await findCustomerOrder(customerUserId, orderId);

    if (order.paymentStatus === "paid") {
        if (order.razorpayPaymentId === razorpayPaymentId) {
            return serializeOrder(order);
        }
        throw createHttpError("This order has already been paid with a different payment", 409);
    }

    if (order.status !== "pending") {
        throw createHttpError("Only pending orders can be paid", 409);
    }

    if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) {
        throw createHttpError("Payment does not match this order", 400);
    }

    const { keySecret } = getRazorpayCredentials();
    const signatureValid = verifyPaymentSignature(
        { razorpayOrderId, razorpayPaymentId, razorpaySignature },
        keySecret
    );
    if (!signatureValid) {
        throw createHttpError("Payment signature verification failed", 400);
    }

    // The signature proves the payment belongs to this Razorpay order. When the
    // Razorpay API is reachable, also confirm the captured amount and capture the
    // payment if the account is configured for manual capture.
    let payment = null;
    try {
        payment = await fetchRazorpayPayment(razorpayPaymentId);
    } catch (error) {
        console.warn(
            "[order-service] Could not verify Razorpay payment details via API; relying on the signature:",
            error.message
        );
    }

    if (payment) {
        if (payment.order_id !== razorpayOrderId) {
            throw createHttpError("Payment does not match this order", 400);
        }
        if (Number.isInteger(payment.amount) && payment.amount !== order.totalMinor) {
            throw createHttpError("Payment amount does not match the order total", 400);
        }
        if (payment.currency && payment.currency !== order.currency) {
            throw createHttpError("Payment currency does not match the order currency", 400);
        }

        if (payment.status === "authorized") {
            payment = await captureRazorpayPayment(razorpayPaymentId, {
                amountMinor: order.totalMinor,
                currency: order.currency
            });
        } else if (payment.status !== "captured") {
            throw createHttpError(`Payment is not captured (status: ${payment.status})`, 409);
        }
    }

    const updated = await confirmPayment(order, {
        razorpayPaymentId,
        amountMinor: order.totalMinor,
        paidAt: toPaymentDate(payment?.created_at)
    });

    if (!updated) {
        throw createHttpError("Payment could not be recorded for this order", 500);
    }
    if (updated.paymentStatus !== "paid") {
        throw createHttpError("Payment could not be recorded for this order", 500);
    }
    if (updated.razorpayPaymentId !== razorpayPaymentId) {
        throw createHttpError("This order has already been paid with a different payment", 409);
    }

    return serializeOrder(updated);
};

export const processRazorpayWebhook = async (rawBody, signature) => {
    const webhookSecret = getRazorpayWebhookSecret();

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        throw createHttpError("Invalid Razorpay webhook signature", 400);
    }

    let event;
    try {
        const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
        event = JSON.parse(text || "{}");
    } catch {
        throw createHttpError("Invalid Razorpay webhook payload", 400);
    }

    const eventName = typeof event?.event === "string" ? event.event : "unknown";
    const payment = event?.payload?.payment?.entity;
    const razorpayOrderId = payment?.order_id;

    if (!razorpayOrderId) {
        return { handled: false, event: eventName };
    }

    const order = await Order.findOne({ razorpayOrderId });
    if (!order) {
        return { handled: false, event: eventName };
    }

    if (eventName === "payment.captured" || eventName === "order.paid") {
        if (typeof payment?.id !== "string" || !payment.id) {
            return { handled: false, event: eventName };
        }

        if (Number.isInteger(payment.amount) && payment.amount !== order.totalMinor) {
            console.warn(
                `[order-service] Ignoring Razorpay webhook for ${order.orderId}: amount ${payment.amount} does not match ${order.totalMinor}`
            );
            return { handled: false, event: eventName };
        }

        if (order.paymentStatus === "paid") {
            if (order.razorpayPaymentId && order.razorpayPaymentId !== payment.id) {
                console.warn(
                    `[order-service] Ignoring Razorpay webhook for ${order.orderId}: a different payment is already recorded`
                );
                return { handled: false, event: eventName };
            }
            return { handled: true, event: eventName, orderId: order.orderId };
        }

        await confirmPayment(order, {
            razorpayPaymentId: payment.id,
            amountMinor: order.totalMinor,
            paidAt: toPaymentDate(payment.created_at)
        });

        return { handled: true, event: eventName, orderId: order.orderId };
    }

    if (eventName === "payment.failed") {
        const reason = payment?.error_description || payment?.error_code || "Payment failed";
        await Order.updateOne(
            { razorpayOrderId, paymentStatus: { $ne: "paid" } },
            {
                $set: {
                    paymentStatus: "failed",
                    paymentFailureReason: String(reason).slice(0, 500)
                }
            }
        );
        return { handled: true, event: eventName, orderId: order.orderId };
    }

    return { handled: false, event: eventName };
};

export default {
    createPaymentSession,
    processRazorpayWebhook,
    verifyOrderPayment
};
