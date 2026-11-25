# API Gateway

Unified API Gateway and reverse-proxy for the Multi-Vendor Marketplace. It bundles all independent microservices behind a single port (`8000`), handling routing, CORS, request tracking, and centralized health aggregation.

## Architecture

```text
                     Frontend Client (:5173)
                                │
                                ▼
                       API Gateway (:8000)
         ┌───────────────┬──────┴────────┬───────────────┐
         ▼               ▼               ▼               ▼
    OTP Service    Vendor Service  Customer Service Order Service
      (:3000)         (:3001)         (:3002)         (:3003)
```

## Route Map

| Path Prefix | Target Microservice | Domain Function |
|---|:---:|---|
| `/auth/customer/*` | `customer-service` (:3002) | Customer OTP request & verification |
| `/customers/*` | `customer-service` (:3002) | Customer profiles & saved address book |
| `/catalog/*` | `customer-service` (:3002) | Public catalog browsing (filtered by approved vendors) |
| `/cart/*` | `customer-service` (:3002) | Customer shopping cart persistence |
| `/orders/*` | `order-service` (:3003) | Customer checkout, order tracking & cancellation |
| `/vendor/orders/*` | `order-service` (:3003) | Vendor sub-orders & fulfillment status updates |
| `/vendor-data/orders/*` | `order-service` (:3003) | Vendor sub-orders & fulfillment status updates |
| `/auth/*` | `vendor-service` (:3001) | Vendor & Admin login, OTP, and password authentication |
| `/register/*` | `vendor-service` (:3001) | Vendor registration |
| `/vendor-data/*` | `vendor-service` (:3001) | Vendor profile & KYC upload |
| `/products/*` | `vendor-service` (:3001) | Vendor product management & image uploads |
| `/admin/*` | `vendor-service` (:3001) | Platform admin audit & approvals |
| `/otp/*` | `otp-service` (:3000) | Direct OTP generation & verification |
| `/api/*` | Dynamic | Transparent prefix alias for all the above |

## System Health Aggregator

```http
GET http://localhost:8000/health
```

Checks all 4 downstream services and returns an aggregated health matrix:

```json
{
  "status": "HEALTHY",
  "gateway": "UP",
  "timestamp": "2026-11-10T15:40:00.000Z",
  "services": {
    "otpService": { "service": "OTP Service", "status": "UP", "latencyMs": 12 },
    "vendorService": { "service": "Vendor Service", "status": "UP", "latencyMs": 15 },
    "customerService": { "service": "Customer Service", "status": "UP", "latencyMs": 10 },
    "orderService": { "service": "Order Service", "status": "UP", "latencyMs": 14 }
  }
}
```

## Local Development

```powershell
cd services/api-gateway
npm run dev
```

## Running Tests

```powershell
npm test
```

