# Current architecture

## Applications

### Frontend

`frontend/marketplace-ui` is a React, TypeScript, and Vite application running on port 5173.
- All client requests can route through the unified **API Gateway** (`http://localhost:8000`), with transparent fallback to individual microservice ports if needed.
- It interacts with **Order Service** (`:3003` or `/orders`, `/vendor/orders`) for checkout, order lifecycle, and fulfillment.
- It interacts with **Customer Service** (`:3002` or `/auth/customer`, `/customers`, `/catalog`, `/cart`) for customer profiles, catalog, and carts.
- It interacts with **Vendor Service** (`:3001` or `/auth`, `/register`, `/vendor-data`, `/products`, `/admin`) for onboarding, KYC, and product catalog management.

### API Gateway

`services/api-gateway` is an Express reverse proxy running on port 8000.
It acts as the single entry point for all frontend and external API traffic:
- Bundles downstream microservices behind unified `/api/*` and resource paths.
- Provides streaming request forwarding for file uploads (KYC docs, product images) which are persisted in Amazon S3 or the local storage fallback.
- Performs aggregated health checks (`/health`) across all 4 downstream services.
- Manages CORS and injects `x-request-id` tracking headers.

### Order service

`services/order-service` is an Express and MongoDB application on port 3003.
It owns:

- multi-vendor cart checkout processing
- atomic inventory deduction & restoration
- customer order creation and cancellation (`/orders`)
- Razorpay payment sessions, server-side signature verification, and payment webhooks (`/orders/:orderId/payment*`, `/payments/razorpay/webhook`)
- vendor sub-order queries and status updates (`/vendor/orders`, `/vendor-data/orders`)
- order lifecycle management (`pending`, `processing`, `completed`, `cancelled`)

### Customer service

`services/customer-service` is an Express and MongoDB application on port 3002.
It owns:

- customer OTP authentication and customer profile registration
- customer profile updates (`/customers/me`)
- customer saved delivery address book (`/customers/me/addresses`)
- public product catalog discovery filtered strictly by vendor approval status (`/catalog/products`)
- customer cart persistence and validation (`/cart`)

It calls the OTP service over HTTP (`:3000`) for customer OTP generation and verification.

### Vendor service

`services/vendor-service` is an Express and MongoDB application on port 3001.
It owns:

- vendor and admin user identities & credentials
- vendor registration (`/register`)
- vendor profile and KYC upload metadata (`/vendor-data`)
- vendor approval and rejection (`/admin`)
- vendor product CRUD and image uploads stored in Amazon S3 or local storage (`/products`)
- vendor & admin JWT authentication

It calls the OTP service over HTTP (`:3000`) for vendor OTP verification.

### OTP service

`services/otp-service` is an Express application on port 3000. It owns:

- OTP generation and hashing
- Redis-backed expiration
- verification attempt limits
- resend limits and cooldowns
- SMTP delivery

## Service Integration

```text
                               frontend (:5173)
                                      │
                                      ▼
                             API Gateway (:8000)
                    ┌─────────────────┼─────────────────┐
                    │ HTTP            │ HTTP            │ HTTP
                    ▼                 ▼                 ▼
          vendor-service (:3001) customer-service (:3002) order-service (:3003)
             │             │         │             │         │
             │ MongoDB     │ HTTP    │ MongoDB     │ HTTP    │ MongoDB
             │             ▼         │             ▼         │
             │       otp-service (:3000)     otp-service (:3000)
             │             │                       │
             │             ├── Redis               ├── Redis
             │             └── SMTP                └── SMTP
             ▼
          Amazon S3 / local storage (product images, KYC documents)
             │
             ▼
          Shared MongoDB (Users, Vendors, Products, Carts, SavedAddresses, Orders)
```

The order service calls the Razorpay REST API over HTTPS to create gateway
orders and confirm payment status. Razorpay calls back
`POST /payments/razorpay/webhook`; the order service verifies the HMAC over the
raw request body before updating an order. The Razorpay key secret stays in the
order service environment and is never sent to the frontend.
