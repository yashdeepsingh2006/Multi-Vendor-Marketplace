# Infrastructure & Deployment

This directory documents the deployment and container configuration for the decoupled multi-vendor marketplace.

## Unified Backend Docker Compose

The entire backend ecosystem (MongoDB, Redis, OTP Service, Vendor Service, Customer Service, Order Service, and API Gateway) is containerized and managed by `docker-compose.yml`.

The frontend (`frontend/marketplace-ui`) runs outside of Docker directly on the host machine to allow instant Hot Module Replacement (HMR) and fast local debugging.

### Start the Backend Stack (Docker)

```powershell
docker compose up -d --build
```

### Start the Frontend (Host)

```powershell
cd frontend\marketplace-ui
npm install
npm run dev
```

### Container Services Layout

| Service | Container Name | Internal Port | Host Port | Internal Network Alias | Dependencies |
|---|---|:---:|:---:|---|---|
| **MongoDB** | `marketplace-mongodb` | 27017 | 27017 | `mongodb`, `mongo` | None |
| **Redis** | `marketplace-redis` | 6379 | 6379 | `redis`, `cache` | None |
| **OTP Service** | `marketplace-otp-service` | 3000 | 3000 | `otp-service` | `redis` (healthy) |
| **Vendor Service** | `marketplace-vendor-service` | 3001 | 3001 | `vendor-service` | `mongodb` (healthy), `otp-service` |
| **Customer Service** | `marketplace-customer-service` | 3002 | 3002 | `customer-service` | `mongodb` (healthy), `otp-service` |
| **Order Service** | `marketplace-order-service` | 3003 | 3003 | `order-service` | `mongodb` (healthy) |
| **API Gateway** | `marketplace-api-gateway` | 8000 | 8000 | `api-gateway` | Downstream services |

### Volumes & Persistence

- `mongo_data`: Stores MongoDB database data (`/data/db`).
- `redis_data`: Stores Redis cache data (`/data`).

### Object Storage (Amazon S3)

Product images and KYC documents are uploaded to Amazon S3 by the vendor
service; no uploads are persisted in a Docker volume. Configure the bucket in
the root `.env` file used by Compose:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
```

The bucket can remain private. Product images are served through the vendor
service with short-lived signed redirects, and KYC documents are downloaded
through authenticated signed URLs. Set `AWS_S3_PUBLIC_BASE_URL` only when a
public CDN/custom domain is configured in front of the bucket.

The IAM principal only needs access to the bucket objects:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

### Management Commands

```powershell
# Build and start all services in the background
docker compose up -d --build

# View real-time logs for all services
docker compose logs -f

# View logs for a specific service (e.g. gateway)
docker compose logs -f api-gateway

# Check status of running containers
docker compose ps

# Stop all services
docker compose down

# Stop all services and wipe volumes (clean start)
docker compose down -v
```
