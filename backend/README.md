# Service When Need — Backend

A production-ready REST API backend for the **Service When Need** service marketplace, where customers book technicians for home appliances and electronics.

Built with **Node.js (>=20)**, **TypeScript**, **Express 5**, **MongoDB**, and **Mongoose**.

---

## Prerequisites

- **Node.js 20+** and **npm** (`node -v` and `npm -v`)
- A running **MongoDB** instance:
  - Local MongoDB (`mongodb://127.0.0.1:27017/service-when-need`)
  - Or MongoDB Atlas connection string (`mongodb+srv://<user>:<password>@cluster.mongodb.net/service-when-need`)

---

## Setup & Installation

```bash
cd backend
npm install
cp .env.example .env
```

Generate a secure `JWT_SECRET` (minimum 32 characters):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Security Note:** `.env` is git-ignored and must never be committed. It contains secrets and connection strings. Only `.env.example` is tracked by git.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Application mode (`development` \| `production` \| `test`). |
| `PORT` | No | `5000` | Port the HTTP server listens on (1–65535). |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string. Server exits with code 1 if missing. |
| `JWT_SECRET` | **Yes** | — | Secret string for signing JWT tokens (HS256). Must be >= 32 characters. |
| `JWT_EXPIRES_IN` | No | `15m` | Token expiration (`<number><unit>`, e.g. `15m`, `1h`, `7d`). |
| `BCRYPT_SALT_ROUNDS` | No | `12` | Salt rounds for bcrypt (integer between 10 and 14). |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window in milliseconds (default: 15 minutes). |
| `RATE_LIMIT_MAX` | No | `300` | General rate limit per IP per window across `/api` routes (excluding `/api/health`). |
| `AUTH_RATE_LIMIT_MAX` | No | `20` | Strict rate limit per IP per window on `/api/auth/register` and `/api/auth/login`. |
| `CORS_ALLOWED_ORIGINS` | No | *(unset)* | Comma-separated list of exact allowed origins (e.g. `http://localhost:5173`). Wildcard `*`, paths, and trailing slashes are strictly rejected. |
| `TRUST_PROXY` | No | *(unset)* | Reverse proxy configuration for Express (e.g. `1` if behind Nginx or Cloudflare) to ensure accurate client IP resolution. |
| `BUFFER_TIMEOUT_MS` | No | `5000` | Mongoose buffering timeout in milliseconds. Queries fail fast with HTTP 503 during outages. |
| `MONGODB_URI_TEST` | Optional | — | Dedicated test database URI for automated tests. Name must end in `_test` and differ from `MONGODB_URI`. |

---

## Development & Production Commands

All commands run from `backend/`:

```bash
# Start development server with auto-reload
npm run dev

# Typecheck application source code
npm run typecheck

# Typecheck test files and test helpers
npm run typecheck:test

# Compile TypeScript to production bundle (dist/)
npm run build

# Start production server
npm start

# Run automated tests
npm test
```

---

## Running Automated Tests

Tests use Node's native test runner (`node:test`, `node:assert/strict`) with `supertest`.

### 1. Run Pure / No-DB Unit Tests (without active MongoDB)
```bash
npm test
```
*Result: 44 pure unit tests execute and pass; 91 DB-dependent tests safely skip.*

### 2. Run Full DB-Backed Suite (against isolated test database)
Supply `MONGODB_URI_TEST` inline pointing to an isolated `_test` database:

```bash
# PowerShell / Windows
$env:MONGODB_URI_TEST="mongodb://127.0.0.1:27017/service-when-need_test"; npm test

# Node securely reading .env without printing secrets
node --env-file=.env -e "const u = process.env.MONGODB_URI.replace(/\/service-when-need(\?|$)/, '/service-when-need_test$1'); require('child_process').spawnSync('npm', ['test'], { stdio: 'inherit', env: { ...process.env, MONGODB_URI_TEST: u }, shell: true });"
```

### Safety Guards Enforced:
1. `MONGODB_URI_TEST` **must** end with `_test`.
2. `MONGODB_URI_TEST` **must not** equal `MONGODB_URI`.
3. The production/application database `service-when-need` is **never** accessed or written to during tests.
4. Test cleanup uses `deleteMany({})` only on the verified test connection; `dropDatabase()` is strictly prohibited.

---

## API Endpoints & Role Permission Matrix

| Endpoint | Method | Public | Customer | Provider | Admin | Notes |
|---|---|:---:|:---:|:---:|:---:|---|
| `/api/health` | GET | ✔ | ✔ | ✔ | ✔ | Real-time health; exempt from rate limits; returns 503 if DB disconnected. |
| `/api/auth/register` | POST | ✔ | — | — | — | Customer/provider registration. Strict rate limit (20/15m). |
| `/api/auth/login` | POST | ✔ | — | — | — | Authenticate with credentials. Strict rate limit (20/15m). |
| `/api/auth/me` | GET | ✖ | ✔ | ✔ | ✔ | View authenticated user profile (`Cache-Control: no-store`). |
| `/api/providers/me` | GET | ✖ | ✖ | ✔ | ✖ | Provider view of own profile (404 if not created). |
| `/api/providers/me` | PUT | ✖ | ✖ | ✔ | ✖ | Create (201) or update (200) provider profile (atomic upsert). |
| `/api/providers` | GET | ✔ | ✔ | ✔ | ✔ | Public paginated providers list (`city`, `providerType`, `q`). |
| `/api/providers/:id` | GET | ✔ | ✔ | ✔ | ✔ | Public provider profile (sanitized; contact info hidden). |
| `/api/services` | POST | ✖ | ✖ | ✔ | ✖ | Create a service under provider's profile (201). |
| `/api/services/my` | GET | ✖ | ✖ | ✔ | ✖ | Provider view of own services (active and inactive). |
| `/api/services` | GET | ✔ | ✔ | ✔ | ✔ | Public paginated active services list (`category`, `city`, `q`). |
| `/api/services/:id` | GET | ✔ | ✔ | ✔ | ✔ | Public service details (owner can also view inactive). |
| `/api/services/:id` | PATCH | ✖ | ✖ | ✔ | ✖ | Update service details (owner only). |
| `/api/services/:id/status` | PATCH | ✖ | ✖ | ✔ | ✖ | Toggle `isActive` status (owner only). |
| `/api/bookings` | POST | ✖ | ✔ | ✖ | ✖ | Create pending booking (201); snapshots title & price. |
| `/api/bookings/my` | GET | ✖ | ✔ | ✔ | ✖ | List caller's bookings (paginated, newest first). Admin gets 403. |
| `/api/bookings/:id` | GET | ✖ | ✔ | ✔ | ✖ | View single booking (parties only; 404 for non-parties). Admin gets 403. |
| `/api/bookings/:id/status` | PATCH | ✖ | ✔ | ✔ | ✖ | Atomic status transition per transition matrix. Admin gets 403. |

*Note: Admins have no access to booking endpoints (returns HTTP 403). No admin creation or admin-management endpoints exist.*

---

## Booking Status Transition Matrix

| Current Status | Target Status | Role Allowed | Semantics & Result |
|---|---|---|---|
| `pending` | `accepted` | Provider | HTTP 200 on success |
| `pending` | `rejected` | Provider | HTTP 200 on success (terminal) |
| `accepted` | `in_progress` | Provider | HTTP 200 on success |
| `in_progress` | `completed` | Provider | HTTP 200 on success (terminal) |
| `pending` | `cancelled` | Customer | HTTP 200 on success (terminal) |
| `accepted` | `cancelled` | Customer | HTTP 200 on success (terminal) |

**Status Codes:**
- **403 Forbidden:** Role cannot set this status (e.g. customer attempting `accepted`, provider attempting `cancelled`, admin on any booking route).
- **404 Not Found:** Resource not found or non-disclosure for non-parties.
- **409 Conflict:** Invalid state transition (e.g. leaving terminal state, skipping steps) or concurrent update conflict.

---

## Request & Response Examples

### 1. Health Check
`GET /api/health`
- **Response (`200 OK`):**
  ```json
  {
    "status": "ok",
    "uptime": 128.45,
    "timestamp": "2026-10-23T22:00:00.000Z",
    "environment": "development",
    "database": {
      "status": "connected"
    }
  }
  ```
- **Response During Database Outage (`503 Service Unavailable`):**
  ```json
  {
    "status": "degraded",
    "uptime": 12.34,
    "timestamp": "2026-10-23T22:00:00.000Z",
    "environment": "development",
    "database": {
      "status": "disconnected"
    }
  }
  ```

### 2. User Registration
`POST /api/auth/register`
- **Request Body:**
  ```json
  {
    "name": "Jane Technician",
    "email": "jane@example.com",
    "password": "Password123",
    "role": "provider"
  }
  ```
- **Response (`201 Created`, `Cache-Control: no-store`):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "67b6f3a1e2c34a0011112222",
        "name": "Jane Technician",
        "email": "jane@example.com",
        "role": "provider",
        "isActive": true,
        "createdAt": "2026-10-23T22:00:00.000Z",
        "updatedAt": "2026-10-23T22:00:00.000Z"
      }
    }
  }
  ```

### 3. User Login
`POST /api/auth/login`
- **Request Body:**
  ```json
  {
    "email": "jane@example.com",
    "password": "Password123"
  }
  ```
- **Response (`200 OK`, `Cache-Control: no-store`):**
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOi...",
      "tokenType": "Bearer",
      "expiresIn": "15m",
      "user": {
        "id": "67b6f3a1e2c34a0011112222",
        "name": "Jane Technician",
        "email": "jane@example.com",
        "role": "provider",
        "isActive": true,
        "createdAt": "2026-10-23T22:00:00.000Z",
        "updatedAt": "2026-10-23T22:00:00.000Z"
      }
    }
  }
  ```

### 4. Create Service
`POST /api/services`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "title": "AC Filter Cleaning and Gas Check",
    "description": "High pressure jet cleaning and gas leak diagnostics for split ACs.",
    "category": "ac",
    "basePrice": 699.00
  }
  ```
- **Response (`201 Created`, `Cache-Control: no-store`):**
  ```json
  {
    "success": true,
    "data": {
      "service": {
        "id": "67b6f3a1e2c34a0087654321",
        "providerId": "67b6f3a1e2c34a0012345678",
        "title": "AC Filter Cleaning and Gas Check",
        "description": "High pressure jet cleaning and gas leak diagnostics for split ACs.",
        "category": "ac",
        "basePrice": 699,
        "isActive": true,
        "createdAt": "2026-10-23T22:00:00.000Z",
        "updatedAt": "2026-10-23T22:00:00.000Z"
      }
    }
  }
  ```

### 5. Create Booking
`POST /api/bookings`
- **Headers:** `Authorization: Bearer <customer_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "serviceId": "67b6f3a1e2c34a0087654321",
    "serviceAddress": "Flat 302, Green View Apartments",
    "city": "Bengaluru",
    "scheduledAt": "2026-11-15T10:30:00.000Z",
    "problemDescription": "AC cooling coil frosting up and weak airflow."
  }
  ```
- **Response (`201 Created`, `Cache-Control: no-store`):**
  ```json
  {
    "success": true,
    "data": {
      "booking": {
        "id": "67b6f3a1e2c34a0099990001",
        "customerId": "67b6f3a1e2c34a0011112222",
        "serviceId": "67b6f3a1e2c34a0087654321",
        "providerId": "67b6f3a1e2c34a0012345678",
        "serviceTitle": "AC Filter Cleaning and Gas Check",
        "basePrice": 699,
        "serviceAddress": "Flat 302, Green View Apartments",
        "city": "Bengaluru",
        "scheduledAt": "2026-11-15T10:30:00.000Z",
        "problemDescription": "AC cooling coil frosting up and weak airflow.",
        "status": "pending",
        "createdAt": "2026-10-23T22:00:00.000Z",
        "updatedAt": "2026-10-23T22:00:00.000Z"
      }
    }
  }
  ```

### 6. Standard Error Response (Validation Error)
`POST /api/auth/register` with invalid email
- **Response (`400 Bad Request`):**
  ```json
  {
    "success": false,
    "error": {
      "message": "email is not valid",
      "statusCode": 400
    }
  }
  ```

### 7. Rate Limit Exceeded Response
Exceeding request limit on `/api/auth/login`
- **Headers:** `HTTP/1.1 429 Too Many Requests`, `Retry-After: 900`, `RateLimit-Limit: 20`, `RateLimit-Remaining: 0`
- **Response (`429 Too Many Requests`):**
  ```json
  {
    "success": false,
    "error": {
      "message": "Too many requests, please try again later",
      "statusCode": 429
    }
  }
  ```

### 8. Database Outage Response
Request during database connection outage / buffer timeout
- **Response (`503 Service Unavailable`):**
  ```json
  {
    "success": false,
    "error": {
      "message": "Service temporarily unavailable",
      "statusCode": 503
    }
  }
  ```

---

## Security Hardening Details

1. **Security Headers:** Custom middleware applies `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Resource-Policy: same-site`. When `NODE_ENV=production`, `Strict-Transport-Security: max-age=15552000; includeSubDomains` is automatically enabled.
2. **Explicit CORS:** Hand-written middleware driven by `CORS_ALLOWED_ORIGINS` allowlist. No wildcard `*` allowed; origin URLs validated at startup; preflight `OPTIONS` returns 204 with 600s cache; `Access-Control-Allow-Credentials` is omitted (Bearer tokens used).
3. **Rate Limiting:** Managed via `express-rate-limit`. Standard `RateLimit-*` draft-7 headers returned; legacy `X-RateLimit-*` disabled. `/api/health` is explicitly exempt so monitoring services are never locked out.
4. **Data Masking & Privacy:** Raw Mongoose documents are never returned. All endpoints use dedicated serializers stripping `_id`, `__v`, `passwordHash`, and cross-party contact details. Error handler sanitizes internal Mongo errors, never echoes duplicate key details, index names, or stack traces in production.
5. **Fast Outage Failures:** `bufferTimeoutMS` is capped at 5000ms. Outage and buffer timeout errors cleanly map to HTTP 503 instead of hanging or throwing unhandled 500s.

---

## Known Limitations & Booking Conflict Analysis

1. **In-Memory Rate Limiting:** Counters are stored in process memory. Counters reset on process restart and are not synchronized across multiple cluster instances (Redis would be required for distributed multi-instance deployments).
2. **Token Revocation & Refresh:** Tokens expire automatically per `JWT_EXPIRES_IN`. There is no token blacklist or refresh token rotation mechanism.
3. **No Admin Management APIs:** Admin role is recognized by RBAC, but no endpoints exist for administrative overrides or admin creation.
4. **No Deletion / Hard Removal:** Resources are deactivated (`isActive: false`) rather than physically deleted.
5. **No File Uploads, Payments, or Notifications:** File uploads, payment processing, customer reviews, and email/SMS notifications are deferred.
6. **Booking Conflict Prevention Limitations (Analysis):**
   - **Provider Capacity & Technicians:** Provider profiles represent either individuals or entire companies with multiple technicians. The current data model does not have technician entities, individual employee calendars, or capacity counters.
   - **Service Durations:** Services do not model estimated or actual duration; `scheduledAt` represents a single point in time, preventing time overlap calculations.
   - **Availability Windows:** There is no concept of working hours, holidays, or provider timezones.
   - *Conclusion:* A naive unique index on `{ providerId, scheduledAt }` would mistakenly prevent companies from serving multiple clients concurrently and would be vulnerable to slot-denial attacks. Therefore, requested times are not reserved slots; providers manually accept or reject bookings based on their real-world schedule. A full availability engine requires technician modeling, service durations, working windows, and slot reservations.

---

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts                   # Environment variables loader & validator
│   │   └── database.ts              # MongoDB connection & bufferTimeoutMS configuration
│   ├── controllers/
│   │   ├── auth.controller.ts       # Auth handlers (register, login, me)
│   │   ├── booking.controller.ts    # Booking handlers (create, list, get, status)
│   │   ├── health.controller.ts     # Health check handler
│   │   ├── provider.controller.ts   # Provider profile handlers
│   │   └── service.controller.ts    # Service catalog handlers
│   ├── middleware/
│   │   ├── auth.middleware.ts       # authenticate, optionalAuthenticate, authorizeRoles
│   │   ├── cors.middleware.ts       # Hand-written CORS allowlist handler
│   │   ├── errorHandler.middleware.ts # Error handler with 503 outage mapping
│   │   ├── notFound.middleware.ts   # 404 handler for unknown routes
│   │   ├── rateLimit.middleware.ts  # Rate limiting with custom 429 response
│   │   └── securityHeaders.middleware.ts # JSON API security headers & HSTS
│   ├── models/
│   │   ├── booking.model.ts         # Booking schema, compound indexes, safe serializer
│   │   ├── providerProfile.model.ts # ProviderProfile schema, compound indexes, serializers
│   │   ├── service.model.ts         # Service schema, categories, compound indexes, serializers
│   │   └── user.model.ts            # User schema, roles, safe serializer
│   ├── routes/
│   │   ├── auth.routes.ts           # Mounted at /api/auth (with authLimiter)
│   │   ├── booking.routes.ts        # Mounted at /api/bookings (/my before /:id)
│   │   ├── health.routes.ts         # Mounted at /api/health (exempt from rate limiter)
│   │   ├── index.ts                 # Aggregates sub-routers with apiLimiter
│   │   ├── provider.routes.ts       # Mounted at /api/providers
│   │   └── service.routes.ts        # Mounted at /api/services
│   ├── services/
│   │   ├── auth.service.ts          # Auth business logic
│   │   ├── booking.service.ts       # Booking lifecycle & atomic status transitions
│   │   ├── catalog.service.ts       # Service catalog business logic
│   │   └── provider.service.ts      # Provider profile business logic
│   ├── types/
│   │   └── express.d.ts             # Express Request augmentation (req.user)
│   ├── utils/
│   │   ├── AppError.ts              # Operational error class with statusCode
│   │   └── validation.ts            # Hand-written input & query validators
│   ├── app.ts                       # Express app wiring with security middlewares
│   └── server.ts                    # HTTP server lifecycle and graceful shutdown
├── tests/
│   ├── helpers/
│   │   └── testDb.ts                # Test DB safety guards & connection helpers
│   ├── auth.test.ts                 # 31 auth unit & integration tests
│   ├── bookings.test.ts             # 27 booking tests (16 unit + 11 integration groups)
│   ├── consistency.test.ts          # Cross-route API error & pagination consistency tests
│   ├── outage.test.ts               # Database outage & 503 mapping behavior tests
│   ├── providers.test.ts            # 12 provider profile tests (3 unit + 9 integration)
│   ├── security.test.ts             # CORS, security headers, rate limit, sensitive scan tests
│   └── services.test.ts             # 23 service catalog tests (3 unit + 20 integration)
├── .env.example                     # Environment template with BUILD 05 placeholders
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.test.json
└── README.md
```
