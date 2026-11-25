import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";

const { authenticate, authorizeRoles } = await import("../middlewares/auth.js");
const {
    validateDeliveryAddress,
    toMinorUnits,
    fromMinorUnits,
    validateOrderId
} = await import("../utils/order.validation.js");
const { parsePagination } = await import("../utils/catalog.validation.js");
const {
    buildRazorpayOrderPayload,
    verifyPaymentSignature,
    verifyWebhookSignature
} = await import("../utils/razorpay.js");

const response = () => {
    const result = {};
    return {
        result,
        status(code) {
            result.status = code;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        }
    };
};

test("order authentication rejects missing bearer token", () => {
    const res = response();
    authenticate({ headers: {} }, res, () => assert.fail("next should not run"));
    assert.equal(res.result.status, 401);
});

test("customer authorization accepts customer and rejects vendor", () => {
    const resFail = response();
    authorizeRoles("customer")({ user: { userId: 10, role: "vendor" } }, resFail, () => {
        assert.fail("next should not run");
    });
    assert.equal(resFail.result.status, 403);

    const resSuccess = response();
    let nextCalled = false;
    authorizeRoles("customer")({ user: { userId: 42, role: "customer" } }, resSuccess, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);
});

test("vendor authorization accepts vendor and admin, rejects customer", () => {
    const resCustomer = response();
    authorizeRoles("vendor", "admin")({ user: { userId: 42, role: "customer" } }, resCustomer, () => {
        assert.fail("next should not run");
    });
    assert.equal(resCustomer.result.status, 403);

    let vendorCalled = false;
    authorizeRoles("vendor", "admin")({ user: { userId: 1001, role: "vendor" } }, response(), () => {
        vendorCalled = true;
    });
    assert.equal(vendorCalled, true);

    let adminCalled = false;
    authorizeRoles("vendor", "admin")({ user: { userId: 99, role: "admin" } }, response(), () => {
        adminCalled = true;
    });
    assert.equal(adminCalled, true);
});

test("delivery address validation normalizes and checks required fields", () => {
    const valid = validateDeliveryAddress({
        recipientName: "  Jane Smith  ",
        phone: "+1 555 9876",
        addressLine1: "456 Market Blvd",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "USA"
    });
    assert.equal(valid.recipientName, "Jane Smith");
    assert.equal(valid.city, "San Francisco");
    assert.equal(valid.addressLine2, null);

    assert.throws(() => validateDeliveryAddress({}), /recipientName is required/);
    assert.throws(() => validateDeliveryAddress({
        recipientName: "Jane",
        phone: "123",
        addressLine1: "123 St",
        city: "City",
        state: "State",
        postalCode: "12345",
        country: "Country",
        unsupportedField: "hack"
    }), /unsupported fields/);
});

test("order currency amounts use integer minor units and accurate roundtrip conversion", () => {
    assert.equal(toMinorUnits(129.99), 12999);
    assert.equal(toMinorUnits(0), 0);
    assert.equal(fromMinorUnits(12999), 129.99);
    assert.equal(fromMinorUnits(0), 0);
    assert.throws(() => toMinorUnits(-5), /price is invalid/);
    assert.throws(() => toMinorUnits(NaN), /price is invalid/);
});

test("order ID validation accepts UUID formatted order IDs and rejects malformed IDs", () => {
    const validId = "ORD-12345678-abcd-1234-ef01-123456789abc";
    assert.equal(validateOrderId(validId), validId);
    assert.throws(() => validateOrderId("ORD-123"), /Invalid order ID/);
    assert.throws(() => validateOrderId("invalid"), /Invalid order ID/);
});

test("order pagination validates page and pageSize bounds", () => {
    assert.deepEqual(parsePagination({ page: "2", pageSize: "10" }), { page: 2, pageSize: 10 });
    assert.throws(() => parsePagination({ page: "-1" }), /positive integer/);
    assert.throws(() => parsePagination({ pageSize: "100" }), /between 1 and 50/);
});

test("Razorpay order payload uses integer minor units and a bounded receipt", () => {
    const payload = buildRazorpayOrderPayload({
        amountMinor: 12999,
        currency: "USD",
        receipt: "  ORD-12345678-abcd-1234-ef01-123456789abc  ",
        notes: { orderId: "ORD-12345678-abcd-1234-ef01-123456789abc", customerUserId: 42 }
    });

    assert.equal(payload.amount, 12999);
    assert.equal(payload.currency, "USD");
    assert.equal(payload.receipt, "ORD-12345678-abcd-1234-ef01-123456789abc");
    assert.equal(payload.notes.customerUserId, "42");

    assert.throws(() => buildRazorpayOrderPayload({
        amountMinor: 0,
        currency: "USD",
        receipt: "ORD-1"
    }), /positive integer/);
    assert.throws(() => buildRazorpayOrderPayload({
        amountMinor: 10.5,
        currency: "USD",
        receipt: "ORD-1"
    }), /positive integer/);
    assert.throws(() => buildRazorpayOrderPayload({
        amountMinor: 100,
        currency: "usd",
        receipt: "ORD-1"
    }), /3-letter ISO code/);
    assert.throws(() => buildRazorpayOrderPayload({
        amountMinor: 100,
        currency: "USD",
        receipt: "a".repeat(41)
    }), /at most 40 characters/);
});

test("Razorpay payment signature verification accepts a valid HMAC and rejects tampering", () => {
    const secret = "test_razorpay_secret";
    const razorpayOrderId = "order_ABC123";
    const razorpayPaymentId = "pay_XYZ789";
    const razorpaySignature = crypto
        .createHmac("sha256", secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

    assert.equal(
        verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }, secret),
        true
    );
    assert.equal(
        verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature: "0".repeat(64) }, secret),
        false
    );
    assert.equal(
        verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId: "pay_OTHER", razorpaySignature }, secret),
        false
    );
    assert.equal(
        verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }, ""),
        false
    );
});

test("Razorpay webhook signature verification uses the exact raw request body", () => {
    const secret = "test_webhook_secret";
    const rawBody = Buffer.from(JSON.stringify({ event: "payment.captured", payload: {} }), "utf8");
    const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    assert.equal(verifyWebhookSignature(rawBody, signature, secret), true);
    assert.equal(verifyWebhookSignature(rawBody.toString("utf8"), signature, secret), true);
    assert.equal(verifyWebhookSignature(Buffer.from(`${rawBody.toString("utf8")} `), signature, secret), false);
    assert.equal(verifyWebhookSignature(rawBody, "not-a-signature", secret), false);
    assert.equal(verifyWebhookSignature(rawBody, signature, ""), false);
});
