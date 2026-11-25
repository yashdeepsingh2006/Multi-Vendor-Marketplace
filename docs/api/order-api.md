# Order Service API Contract

This document specifies the contract for `services/order-service`.
The base URL is `http://localhost:3003` (configurable via `VITE_ORDER_SERVICE_URL`).

## Authentication

All order endpoints require a valid Bearer JWT:

```http
Authorization: Bearer <JWT>
```

- **Customer operations** require `role: "customer"`.
- **Vendor fulfillment operations** require `role: "vendor"` or `role: "admin"`.

---

## Customer Order Endpoints

### 1. Create Order (Checkout)
```http
POST /orders
Content-Type: application/json
Authorization: Bearer <Customer-JWT>

{
  "savedAddressId": "64b1f8e123456789abcdef01"
}
```
*Or with inline address:*
```http
POST /orders
Content-Type: application/json
Authorization: Bearer <Customer-JWT>

{
  "deliveryAddress": {
    "recipientName": "Jane Smith",
    "phone": "+1 555 1234",
    "addressLine1": "100 Market St",
    "city": "San Francisco",
    "state": "CA",
    "postalCode": "94105",
    "country": "USA"
  }
}
```

### 2. List Customer Orders
```http
GET /orders?page=1&pageSize=20
Authorization: Bearer <Customer-JWT>
```

### 3. Get Order Details
```http
GET /orders/:orderId
Authorization: Bearer <Customer-JWT>
```

### 4. Cancel Order
```http
POST /orders/:orderId/cancel
Authorization: Bearer <Customer-JWT>
```
Only orders in `status: "pending"` with `paymentStatus: "pending"` may be
cancelled. Cancellation restores inventory once.

### 5. Create Payment Session
```http
POST /orders/:orderId/payment
Authorization: Bearer <Customer-JWT>
```

Creates (or reuses) a Razorpay order for the authoritative database total and
returns the public checkout configuration. Ownership is enforced; other customers
receive `404`.

```json
{
  "message": "Payment session created successfully",
  "data": {
    "alreadyPaid": false,
    "order": {
      "orderId": "ORD-12345678-abcd-1234-ef01-123456789abc",
      "status": "pending",
      "paymentStatus": "pending",
      "total": 129.99,
      "currency": "USD"
    },
    "payment": {
      "provider": "razorpay",
      "keyId": "rzp_live_********",
      "razorpayOrderId": "order_ABC123",
      "amount": 12999,
      "currency": "USD",
      "name": "Atelier Objects",
      "description": "Order ORD-12345678-abcd-1234-ef01-123456789abc",
      "prefill": {
        "name": "Jane Smith",
        "email": "buyer@example.com",
        "contact": "+1 555 1234"
      }
    }
  }
}
```

`amount` is an integer in the smallest currency unit (cents for USD). The
Razorpay **key secret never leaves the server**. If the order is already paid,
`alreadyPaid` is `true` and `payment` is `null`. Already-created Razorpay orders
are reused so a retry does not create duplicate gateway orders. When a prior
attempt was charged but the browser never confirmed it, this endpoint detects
the captured payment from Razorpay, records it, and returns `alreadyPaid: true`
instead of opening a second payment.

Errors: `409` when the order is not payable (not pending, refunded, or has no
payable amount), `503` when Razorpay credentials are not configured, and `502`
when Razorpay rejects the order request.

### 6. Verify Payment
```http
POST /orders/:orderId/payment/verify
Content-Type: application/json
Authorization: Bearer <Customer-JWT>

{
  "razorpayOrderId": "order_ABC123",
  "razorpayPaymentId": "pay_XYZ789",
  "razorpaySignature": "<razorpay_signature>"
}
```

The server verifies the HMAC-SHA256 signature over
`razorpayOrderId|razorpayPaymentId` using the Razorpay key secret, confirms the
payment belongs to the stored Razorpay order, and (when the Razorpay API is
reachable) confirms the amount/currency and captures authorized payments.
Success is idempotent and marks the order:

```json
{ "status": "processing", "paymentStatus": "paid" }
```

Orders also expose a `payment` snapshot:

```json
{
  "provider": "razorpay",
  "razorpayOrderId": "order_ABC123",
  "razorpayPaymentId": "pay_XYZ789",
  "paidAmount": 129.99,
  "paidAt": "2026-11-25T10:15:00.000Z"
}
```

Invalid or tampered signatures return `400`; mismatched orders return `400`;
payments for non-pending orders or with a different payment ID return `409`.

---

## Razorpay Webhook

```http
POST /payments/razorpay/webhook
Content-Type: application/json
X-Razorpay-Signature: <signature>
```

This endpoint is public (Razorpay calls it), but every request is authenticated
with the `RAZORPAY_WEBHOOK_SECRET` HMAC over the exact raw request body. It is
mounted before `express.json()` so the raw bytes are preserved. Configure the
same secret and this URL in the Razorpay dashboard.

Handled events:

- `payment.captured` / `order.paid`: marks the matching order `paid` and
  `processing` (idempotent; amount is checked against the stored total).
- `payment.failed`: marks an unpaid order `failed` and stores a safe failure
  reason.

Unknown events and unknown Razorpay order IDs return `200` with
`{ "received": true, "handled": false }` so Razorpay does not retry
indefinitely. Missing webhook configuration returns `503`.

### Required environment

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...        # optional for checkout, required for webhooks
RAZORPAY_CHECKOUT_NAME=Atelier Objects
```

The Razorpay account must support the order currency (`USD` in this project);
otherwise order creation returns `502` with Razorpay's error message. The
browser receives only the public `keyId`.

---

## Vendor Order Endpoints

### 1. List Vendor Orders
```http
GET /vendor/orders
Authorization: Bearer <Vendor-JWT>
```
*Alias: `GET /vendor-data/orders` or `GET /orders/vendor`*

Returns all sub-orders containing items sold by the authenticated vendor.

### 2. Update Vendor Order Status
```http
PATCH /vendor/orders/:orderId/status
Content-Type: application/json
Authorization: Bearer <Vendor-JWT>

{
  "status": "processing"
}
```
*Status values*: `processing`, `completed`, `cancelled`.

