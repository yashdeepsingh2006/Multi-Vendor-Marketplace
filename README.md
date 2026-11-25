# Multi-Vendor Marketplace

This repository contains the architecture and implementation for a decoupled multi-vendor marketplace.
The microservices are kept independently runnable and scalable.

## Repository layout

```text
Multi-Vendor-Marketplace/
├── frontend/
│   └── marketplace-ui/      # React + TypeScript + Vite frontend (:5173)
├── services/
│   ├── api-gateway/         # Unified reverse proxy & routing hub (:8000)
│   ├── order-service/       # Order processing, multi-vendor cart checkout, inventory reservation, and vendor fulfillment (:3003)
│   ├── customer-service/    # Customer profiles, addresses, public catalog, and cart (:3002)
│   ├── vendor-service/      # Vendor identity, profiles, KYC, products, and admin approval (:3001)
│   └── otp-service/         # OTP generation, Redis storage, rate limiting, and email delivery (:3000)
├── infrastructure/          # Container and reverse-proxy notes/configuration
├── docs/                    # Architecture and local-development documentation
└── .github/                 # Reserved for future GitHub workflows
```

## Running the Backend Stack with Docker

All backend services (MongoDB, Redis, OTP Service, Vendor Service, Customer Service, Order Service, and API Gateway) can be started together with a single command:

```powershell
docker compose up -d --build
```

Then start the frontend on your host machine for instant Hot Module Replacement (HMR):

```powershell
cd frontend\marketplace-ui
npm run dev
```

To stop all running backend containers:

```powershell
docker compose down
```

## File storage (Amazon S3)

KYC documents and product images are stored in Amazon S3. Copy `.env.example`
to `.env` and fill in the AWS placeholders before starting the stack:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
```

The IAM user needs `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on the
bucket. The bucket stays private: product images are proxied through the API
and KYC documents are downloaded with short-lived signed URLs.

For container logs and persistence details, see [Infrastructure & Deployment](infrastructure/README.md).

## Local development (All Services Without Docker)

Start the backend services from their own directories:

```powershell
# 1. OTP Microservice (Port 3000)
cd services\otp-service
npm run dev
```

```powershell
# 2. Vendor Microservice (Port 3001)
cd services\vendor-service
npm run dev
```

```powershell
# 3. Customer Microservice (Port 3002)
cd services\customer-service
npm run dev
```

```powershell
# 4. Order Microservice (Port 3003)
cd services\order-service
npm run dev
```

```powershell
# 5. API Gateway (Port 8000)
cd services\api-gateway
npm run dev
```

Then start the frontend:

```powershell
cd frontend\marketplace-ui
npm run dev
```

The default local ports are:

| Application | Port |
|---|---:|
| OTP service | 3000 |
| Vendor service | 3001 |
| Customer service | 3002 |
| Order service | 3003 |
| API Gateway | 8000 |
| Vite frontend | 5173 |

MongoDB and Redis must be available locally. Environment files remain inside
their owning service directories and must not be committed.

See [current architecture](docs/architecture/current-state.md) and
[local setup](docs/development/local-setup.md) for more context.
