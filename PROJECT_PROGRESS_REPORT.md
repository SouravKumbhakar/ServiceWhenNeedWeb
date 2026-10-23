# Service When Need — Backend Project Progress Report

**Generated:** October 23, 2026  
**Project:** Service When Need (Service Marketplace Platform)  
**Current State:** Completed BUILD 01, BUILD 02, BUILD 03, BUILD 04, and BUILD 05  
**Architecture:** Modular Monolith REST API  
**Core Stack:** Node.js v24, TypeScript, Express 5, MongoDB, Mongoose, express-rate-limit, dotenv  

---

## Executive Summary

The backend foundation, authentication engine, provider management system, service catalog, booking management, and API hardening/security readiness modules are fully implemented, verified, and running.

The test suite contains **135 tests** across 28 suites (`auth`, `providers`, `services`, `bookings`, `security`, `consistency`, and `outage`). When run without an active test database connection, all **44 pure unit tests** execute and pass (with 91 DB-dependent tests safely skipping). When run against the verified isolated test database (`service-when-need_test`), all **135 automated tests** execute and pass with 0 failures and 0 skips.

The production build compiles cleanly without errors (`dist/server.js` generated, no test files in `dist/`), and `npm audit --omit=dev` reports **0 vulnerabilities**. Strict security boundaries, non-leaking serializers, hand-written CORS allowlists, security headers, rate limiting with health exemption, atomic concurrency guards, fast-failing 503 outage resilience, and regression protections have been proven through direct execution.

---

## 1. Build Breakdown & Status

| Build Milestone | Description | Status | Test Coverage |
|---|---|:---:|:---:|
| **BUILD 01: Project Foundation** | Express 5 setup, Mongoose connection management with auto-reconnect, centralized error handling (`AppError`), health check (`/api/health`). | **COMPLETED** | Verified via Health Check & Outage Suites |
| **BUILD 02: Authentication & User Management** | User schema, bcrypt password hashing, timing-safe login, JWT issuance (`HS256`), role-based access control (`customer`, `provider`, `admin`), safe serializers. | **COMPLETED** | 31 Automated Tests |
| **BUILD 03: Provider Profiles & Service Catalog** | Provider profiles (`individual`/`company`), phone normalization, service catalog, categorical filtering, public vs owner views, query injection guards. | **COMPLETED** | 35 Automated Tests (12 Provider + 23 Service) |
| **BUILD 04: Booking Management & Lifecycle** | Customer booking creation with price/title snapshot, customer/provider paginated booking list (`/my`), single booking access control, atomic status transitions with matrix validation (`pending`, `accepted`, `rejected`, `in_progress`, `completed`, `cancelled`). | **COMPLETED** | 27 Automated Tests (16 unit + 11 integration groups) |
| **BUILD 05: Backend Hardening & API Readiness** | Rate limiting (`express-rate-limit`, health exempt, strict auth limit), hand-written CORS allowlist (`CORS_ALLOWED_ORIGINS`), JSON security headers (`nosniff`, `DENY`, `no-referrer`, `same-site`, `HSTS` in production), production stack suppression, 503 outage fast-fail (`bufferTimeoutMS: 5000`), compound indexes (`ProviderProfile`, `Booking`), cross-route API consistency, sensitive data scan. | **COMPLETED** | 42 Automated Tests (15 Security + 8 Consistency + 4 Outage + regression suites) |

---

## 2. API Endpoints Currently Available

### Health & Monitoring
- `GET /api/health` — Public real-time operational status (database connectivity, uptime, environment). Exempt from rate limiting. Returns HTTP 503 `degraded` if MongoDB is disconnected.

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Public registration for customers and service providers. Strict rate limit (`20` per 15m). Returns `Cache-Control: no-store`.
- `POST /api/auth/login` — Public login; returns signed JWT (`15m` validity) and sanitized user object. Strict rate limit (`20` per 15m). Returns `Cache-Control: no-store`.
- `GET /api/auth/me` — Authenticated profile view for the logged-in user. Returns `Cache-Control: no-store`.

### Provider Profiles (`/api/providers`)
- `GET /api/providers/me` — Provider owner view of their profile (404 if none created).
- `PUT /api/providers/me` — Create (`201`) or update (`200`) provider profile (atomic upsert).
- `GET /api/providers` — Public paginated listing of active providers with filters (`city`, `providerType`, `q`).
- `GET /api/providers/:id` — Public provider details (masks phone, address, and user ID).

### Service Catalog (`/api/services`)
- `POST /api/services` — Create a service under the authenticated provider's profile (201).
- `GET /api/services/my` — Provider view of all owned services (both active and inactive).
- `GET /api/services` — Public paginated listing of active services from active providers (`category`, `city`, `q`).
- `GET /api/services/:id` — Public view of an active service (owners can also view their inactive services).
- `PATCH /api/services/:id` — Owner updates to service fields (`title`, `description`, `category`, `basePrice`).
- `PATCH /api/services/:id/status` — Owner toggles active/inactive status (`isActive: boolean`).

### Booking Management (`/api/bookings`)
- `POST /api/bookings` — Customer creates a pending booking (201); snapshots `serviceTitle` and `basePrice`.
- `GET /api/bookings/my` — Paginated list of caller's bookings (newest first). Customer sees own bookings; provider sees bookings for their profile. Admin receives 403.
- `GET /api/bookings/:id` — Single booking retrieval. Restricted strictly to booking parties (customer or provider); returns 404 for non-parties to prevent information leakage. Admin receives 403.
- `PATCH /api/bookings/:id/status` — State transitions validated against a strict matrix. Atomic update via `findOneAndUpdate` prevents concurrent race conditions. Admin receives 403.

---

## 3. Data Models & Supporting Indexes

### 1. User (`src/models/user.model.ts`)
- `name`: String (2–100 chars, trimmed)
- `email`: String (lowercase, trimmed, unique index)
- `passwordHash`: String (bcrypt, `select: false` so it is never returned in queries)
- `role`: Enum (`customer` | `provider` | `admin`, default: `customer`)
- `isActive`: Boolean (default: `true`)
- `timestamps`: `createdAt`, `updatedAt`

### 2. ProviderProfile (`src/models/providerProfile.model.ts`)
- `user`: ObjectId ref `User` (unique index — 1:1 user-to-profile guarantee)
- `providerType`: Enum (`individual` | `company`)
- `displayName`: String (2–100 chars, trimmed)
- `phone`: String (normalized to 7–15 digits with optional leading `+`)
- `address`: String (5–200 chars, trimmed — private field)
- `city`: String (2–80 chars, trimmed)
- `cityKey`: String (lowercased, indexed for fast case-insensitive lookups)
- `description`: String (optional, up to 1000 chars)
- `isActive`: Boolean (default: `true`, indexed)
- `timestamps`: `createdAt`, `updatedAt`
- **Compound Indexes:**
  - `{ isActive: 1, cityKey: 1, createdAt: -1 }` (supports public provider listing with city filter and sort)

### 3. Service (`src/models/service.model.ts`)
- `provider`: ObjectId ref `ProviderProfile` (indexed)
- `title`: String (3–120 chars, trimmed)
- `description`: String (10–2000 chars, trimmed)
- `category`: Enum (`ac` | `refrigerator` | `fan` | `computer` | `mobile` | `other`)
- `basePrice`: Number (0 to 10,000,000 with at most 2 decimal places)
- `isActive`: Boolean (default: `true`, indexed)
- `timestamps`: `createdAt`, `updatedAt`
- **Compound Indexes:**
  - `{ provider: 1, createdAt: -1 }` (supports provider's `/services/my` listing)
  - `{ isActive: 1, category: 1, createdAt: -1 }` (supports public service listing with category filter)

### 4. Booking (`src/models/booking.model.ts`)
- `customerId`: ObjectId ref `User` (indexed)
- `serviceId`: ObjectId ref `Service`
- `providerId`: ObjectId ref `ProviderProfile` (indexed)
- `serviceTitle`: String (trimmed snapshot from `Service.title`)
- `basePrice`: Number (non-negative snapshot from `Service.basePrice`)
- `serviceAddress`: String (5–200 chars, trimmed)
- `city`: String (2–80 chars, trimmed)
- `scheduledAt`: Date (stored as UTC Date, validated ISO 8601 string with explicit timezone, strictly in the future, <= 365 days)
- `problemDescription`: String (optional, max 1000 chars)
- `status`: Enum (`pending` | `accepted` | `rejected` | `in_progress` | `completed` | `cancelled`, default: `pending`)
- `timestamps`: `createdAt`, `updatedAt`
- **Compound Indexes:**
  - `{ customerId: 1, createdAt: -1, _id: -1 }` (supports customer `/bookings/my` listing)
  - `{ providerId: 1, createdAt: -1, _id: -1 }` (supports provider `/bookings/my` listing)
  - `{ customerId: 1, status: 1, createdAt: -1 }` (supports customer `/bookings/my?status=...` filter)
  - `{ providerId: 1, status: 1, createdAt: -1 }` (supports provider `/bookings/my?status=...` filter)

---

## 4. Verification & Quality Assurance Summary

### Test Suite Execution
- **Total Tests:** 135 tests across 28 test suites
- **Pure Unit Tests (No DB needed):** 44 passed (8 in BUILD 02/03 + 16 in BUILD 04 + 20 in BUILD 05)
- **DB-backed Tests:** 91 cleanly skipped when `MONGODB_URI_TEST` is unset; 100% passing when connected.
- **Environment Isolation:** Tests automatically run against an isolated `service-when-need_test` database with safety guards preventing accidental writes or drops to `service-when-need`.
- **Offline / Outage Behavior:** When database is disconnected, `/api/health` returns HTTP 503 (`degraded`), and database operations fail fast within bounded `bufferTimeoutMS: 5000` with clean HTTP 503 JSON (`Service temporarily unavailable`) and no stack trace in production.

### Security & Hardening (BUILD 05)
- **Rate Limiting:** General `/api` traffic limited to 300 req / 15m; sensitive credential routes (`/api/auth/register` and `/api/auth/login`) strictly limited to 20 req / 15m. Custom 429 JSON response with `Retry-After` header. `/api/health` is exempt from rate limiting.
- **Explicit CORS:** Custom middleware validates `CORS_ALLOWED_ORIGINS` allowlist at startup. Wildcards (`*`), paths, and trailing slashes are rejected. Preflight `OPTIONS` requests receive HTTP 204 with 600s cache and `Vary: Origin`. `Access-Control-Allow-Credentials` is omitted.
- **Security Headers:** Hand-written middleware applies `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, and `Strict-Transport-Security: max-age=15552000; includeSubDomains` in production. `x-powered-by` is disabled.
- **Zero Sensitive Data Leakage:** Automated scan tests confirm response bodies across all routes never contain `passwordHash`, `password`, bcrypt hashes (`$2a$`, `$2b$`), `JWT_SECRET`, internal `_id`, or `__v`.
- **Consistent Response Shapes:** All error responses follow `{ success: false, error: { message, statusCode } }`. All paginated lists follow `{ success: true, data: { items: [...], pagination: { page, limit, total, totalPages } } }`.
- **Cache-Control:** All authenticated endpoints consistently emit `Cache-Control: no-store`.
- **Audit Status:** `npm audit --omit=dev` reports **0 vulnerabilities**.

---

## 5. Next Recommended Builds (Planning Only)

1. **BUILD 06: Provider Availability & Time Slot Management:**
   - Technician entity modeling (providers as companies with staff vs. solo technicians).
   - Service duration estimates (enables time-interval overlap calculations).
   - Working hours, holiday schedules, and provider time zones.
   - Slot reservations and provider-side conflict prevention.
2. **BUILD 07: Payments & Financial Accounting:**
   - Payment gateway integration, escrow hold on booking creation, capture upon completion, refund processing on cancellation.
3. **BUILD 08: Customer Reviews & Technician Ratings:**
   - Post-service rating and review submissions (restricted to completed bookings).
4. **BUILD 09: Notifications & Real-Time Alerts:**
   - Email/SMS transaction alerts and real-time status updates via WebSockets/SSE.
5. **BUILD 10: Administrative Console:**
   - Dedicated administrative audit logs, provider verification workflows, and dispute resolution.
