# Order Service

Dedicated order processing, multi-vendor cart checkout, inventory deduction, order lifecycle tracking, Razorpay payment verification, and vendor fulfillment microservice.

## Capabilities

- **Multi-Vendor Checkout**: Atomic inventory deduction, multi-store sub-order grouping, and cart clearing.
- **Customer Order Tracking**: Order status tracking, order list pagination, and cancellation with stock restoration.
- **Razorpay Payments**: Server-created Razorpay orders, HMAC payment signature verification, optional capture of authorized payments, and webhook handling for `payment.captured` / `payment.failed`.
- **Vendor Fulfillment API**: Dedicated endpoints for vendors to inspect their sub-orders and update fulfillment statuses (`pending` -> `processing` -> `completed`).

## Default Local Configuration

- **Port**: `3003` (configurable via `PORT` in `.env`)
- **Database**: MongoDB (`MONGO_URI=mongodb://localhost:27017/`)
- **Shared Entities**: Reads approved `vendors`, `products`, `carts`, and writes `orders`.

### Razorpay configuration

Copy `.env.example` to `.env` and fill in:

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_CHECKOUT_NAME=Atelier Objects
# Required only for the webhook endpoint:
# RAZORPAY_WEBHOOK_SECRET=
```

`RAZORPAY_KEY_SECRET` is used only on the server. The browser receives the
public key ID from `POST /orders/:orderId/payment`; it is never given the
secret. The Razorpay account must support the order currency (`USD`).

Configure the webhook in the Razorpay dashboard as:

```text
https://<your-public-host>/payments/razorpay/webhook
```

Use the same value for `RAZORPAY_WEBHOOK_SECRET`. Signature verification is
performed against the exact raw request body.

## Endpoints

### Customer Endpoints
- `POST /orders`: Place multi-vendor order from cart
- `GET /orders?page=1&pageSize=20`: List customer orders
- `GET /orders/:orderId`: Get order details
- `POST /orders/:orderId/cancel`: Cancel pending order and restore stock
- `POST /orders/:orderId/payment`: Create or reuse a Razorpay payment session
- `POST /orders/:orderId/payment/verify`: Verify the Razorpay signature and mark the order paid

### Webhook Endpoint
- `POST /payments/razorpay/webhook`: Razorpay webhook authenticated with `RAZORPAY_WEBHOOK_SECRET`

### Vendor Endpoints
- `GET /vendor/orders` (or `/orders/vendor`): List sub-orders containing products sold by the authenticated vendor
- `PATCH /vendor/orders/:orderId/status`: Update fulfillment status (`processing`, `completed`, `cancelled`)

## Local Development

```powershell
cd services/order-service
npm run dev
```

## Running Tests

```powershell
npm test
```

