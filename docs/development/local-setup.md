# Local development setup

## Option A: Run Backend in Docker & Frontend Locally (Recommended)

Start all backend microservices, MongoDB, Redis, and the API Gateway in Docker:

```powershell
docker compose up -d --build
```

Then start the frontend on your local machine with hot-reloading:

```powershell
cd frontend\marketplace-ui
npm install
npm run dev
```

The frontend will run at `http://localhost:5173` and connect to the API Gateway running in Docker at `http://localhost:8000`.

To stop the backend containers:

```powershell
docker compose down
```

See [infrastructure/README.md](../../infrastructure/README.md) for volume persistence and advanced container commands.

## Option B: Run Services Manually (Without Docker)

### Prerequisites

- Node.js 20 or a compatible current Node.js release
- npm
- MongoDB
- Redis
- SMTP credentials for sending OTP email

## Start the OTP service

```powershell
cd services\otp-service
npm install
npm run dev
```

The OTP service uses `services\otp-service\.env` (default port `3000`).

## Start the vendor service

```powershell
cd services\vendor-service
npm install
npm run dev
```

The vendor service uses `services\vendor-service\.env` (default port `3001`). Its
`OTP_SERVICE_URL` should point to `http://localhost:3000`.

## Start the customer service

```powershell
cd services\customer-service
npm install
npm run dev
```

The customer service uses `services\customer-service\.env` (default port `3002`).

## Start the order service

```powershell
cd services\order-service
npm install
npm run dev
```

The order service uses `services\order-service\.env` (default port `3003`).

## Start the API Gateway

```powershell
cd services\api-gateway
npm install
npm run dev
```

The API Gateway uses `services\api-gateway\.env` (default port `8000`). It routes traffic to services running on ports 3000, 3001, 3002, and 3003.

## Start the frontend

```powershell
cd frontend\marketplace-ui
npm install
npm run dev
```

The frontend uses `frontend\marketplace-ui\.env.local`:
- `VITE_API_GATEWAY_URL=http://localhost:8000`
- `VITE_VENDOR_SERVICE_URL=http://localhost:3001`
- `VITE_CUSTOMER_SERVICE_URL=http://localhost:3002`
- `VITE_ORDER_SERVICE_URL=http://localhost:3003`

## Basic checks

```powershell
# Health of individual microservices
Invoke-WebRequest http://localhost:3000/
Invoke-WebRequest http://localhost:3001/health
Invoke-WebRequest http://localhost:3002/health
Invoke-WebRequest http://localhost:3003/health

# Aggregated health probe via API Gateway
Invoke-WebRequest http://localhost:8000/health
```
