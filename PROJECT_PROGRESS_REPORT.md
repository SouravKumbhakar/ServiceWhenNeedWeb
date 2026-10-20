# Service When Need — Backend Project Progress Report

**Generated:** October 20, 2026  
**Project:** Service When Need (Service Marketplace Platform)  
**Current State:** Completed BUILD 01, BUILD 02, and BUILD 03  
**Architecture:** Modular Monolith REST API  
**Core Stack:** Node.js v24, TypeScript, Express 5, MongoDB, Mongoose, dotenv  

---

## Executive Summary

The backend foundation, authentication engine, provider management system, and service catalog modules are fully implemented, verified, and running. 

All **66 automated tests** pass against the live MongoDB Atlas test cluster, with zero security vulnerabilities detected via `npm audit`. Strict security boundaries, non-leaking serializers, and resilient error-handling practices have been maintained across all three completed builds.

---

## 1. Build Breakdown & Status

| Build Milestone | Description | Status | Test Coverage |
|---|---|:---:|:---:|
| **BUILD 01: Project Foundation** | Express 5 setup, Mongoose connection management with auto-reconnect, centralized error handling (`AppError`), health check (`/api/health`). | **COMPLETED** | Verified via Health Check & Startup Harness |
| **BUILD 02: Authentication & User Management** | User schema, bcrypt password hashing, timing-safe login, JWT issuance (`HS256`), role-based access control (`customer`, `provider`, `admin`), safe serializers. | **COMPLETED** | 31 Automated Tests Passed |
| **BUILD 03: Provider Profiles & Service Catalog** | Provider profiles (`individual`/`company`), phone normalization, service catalog, categorical filtering, public vs owner views, query injection guards. | **COMPLETED** | 35 Automated Tests Passed (12 Provider + 23 Service) |
| **BUILD 04: Bookings & Scheduling** | Customer booking workflow, technician scheduling, booking status lifecycle. | *Upcoming* | *Pending Specification* |

---

## 2. API Endpoints Currently Available

### Health & Monitoring
- `GET /api/health` — Public real-time operational status (database connectivity, uptime, environment).

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Public registration for customers and service providers.
- `POST /api/auth/login` — Public login; returns signed JWT (`15m` validity) and sanitized user object.
- `GET /api/auth/me` — Authenticated profile view for the logged-in user.

### Provider Profiles (`/api/providers`)
- `GET /api/providers/me` — Provider owner view of their profile (404 if none created).
- `PUT /api/providers/me` — Create (`201`) or update (`200`) provider profile (atomic upsert).
- `GET /api/providers` — Public paginated listing of active providers with filters (`city`, `providerType`, `q`).
- `GET /api/providers/:id` — Public provider details (masks phone, address, and user ID).

### Service Catalog (`/api/services`)
- `POST /api/services` — Create a service under the authenticated provider's profile.
- `GET /api/services/my` — Provider view of all owned services (both active and inactive).
- `GET /api/services` — Public paginated listing of active services from active providers (`category`, `city`, `q`).
- `GET /api/services/:id` — Public view of an active service (owners can also view their inactive services).
- `PATCH /api/services/:id` — Owner updates to service fields (`title`, `description`, `category`, `basePrice`).
- `PATCH /api/services/:id/status` — Owner toggles active/inactive status (`isActive: boolean`).

---

## 3. Data Models Implemented

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
- `isActive`: Boolean (default: `true`)
- `timestamps`: `createdAt`, `updatedAt`

### 3. Service (`src/models/service.model.ts`)
- `provider`: ObjectId ref `ProviderProfile` (indexed)
- `title`: String (3–120 chars, trimmed)
- `description`: String (10–2000 chars, trimmed)
- `category`: Enum (`ac` | `refrigerator` | `fan` | `computer` | `mobile` | `other`)
- `basePrice`: Number (0 to 10,000,000 with at most 2 decimal places)
- `isActive`: Boolean (default: `true`)
- `timestamps`: `createdAt`, `updatedAt`
- Compound Indexes: `{ provider: 1, createdAt: -1 }` and `{ isActive: 1, category: 1, createdAt: -1 }`

---

## 4. Verification & Quality Assurance Summary

### Test Suite Execution
- **Total Tests:** 66
- **Passing:** 66 (100%)
- **Failing:** 0
- **Skipped:** 0 (when connected to test database)
- **Environment Isolation:** Tests automatically run against an isolated `_test` database (`service-when-need_test`) with built-in safety guards preventing modifications to the primary database.
- **Offline / No-DB Behavior:** When run without `MONGODB_URI_TEST`, all 8 pure validation unit tests execute and pass, while the 58 DB-dependent tests skip cleanly.

### Security & Hardening
- **Zero Raw Document Exposure:** All outputs pass through dedicated serializers (`toSafeUser`, `toOwnerProviderProfile`, `toPublicProviderProfile`, `toOwnerService`, `toPublicService`).
- **Data Privacy:** Public endpoints strictly omit sensitive fields (`passwordHash`, phone numbers, street addresses, and internal user IDs).
- **Anti-Timing Attack Measures:** Dummy hash comparison on login when the email does not exist prevents email enumeration.
- **NoSQL Operator Injection Protection:** Query and body parsers strictly validate parameter types and reject non-string or nested object injections (`[$ne]`, `[$regex]`, etc.).
- **Request Body Limits:** JSON payload size is restricted to `10kb` to mitigate denial-of-service vulnerabilities.
- **Audit Status:** `npm audit --omit=dev` reports **0 vulnerabilities**.

---

## 5. Directory Structure Overview

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts                   # Environment variable loader & strict validator
│   │   └── database.ts              # Resilient MongoDB connection manager
│   ├── controllers/
│   │   ├── auth.controller.ts       # Auth handlers
│   │   ├── health.controller.ts     # Health monitoring handler
│   │   ├── provider.controller.ts   # Provider profile handlers
│   │   └── service.controller.ts    # Service catalog handlers
│   ├── middleware/
│   │   ├── auth.middleware.ts       # authenticate, optionalAuthenticate, authorizeRoles
│   │   ├── errorHandler.middleware.ts # Standardized JSON error response handler
│   │   └── notFound.middleware.ts   # 404 route handler
│   ├── models/
│   │   ├── providerProfile.model.ts # ProviderProfile model & serializers
│   │   ├── service.model.ts         # Service model & serializers
│   │   └── user.model.ts            # User model & safe serializer
│   ├── routes/
│   │   ├── auth.routes.ts           # Mounted at /api/auth
│   │   ├── health.routes.ts         # Mounted at /api/health
│   │   ├── index.ts                 # Central router
│   │   ├── provider.routes.ts       # Mounted at /api/providers
│   │   └── service.routes.ts        # Mounted at /api/services
│   ├── services/
│   │   ├── auth.service.ts          # Auth business logic & JWT generation
│   │   ├── catalog.service.ts       # Service catalog business logic
│   │   └── provider.service.ts      # Provider profile business logic
│   ├── types/
│   │   └── express.d.ts             # Express Request augmentation (req.user)
│   ├── utils/
│   │   ├── AppError.ts              # Operational error class
│   │   └── validation.ts            # Hand-written input & query validators
│   ├── app.ts                       # Express application wiring
│   └── server.ts                    # HTTP server startup & graceful shutdown
├── tests/
│   ├── helpers/
│   │   └── testDb.ts                # Database isolation & test auth helpers
│   ├── auth.test.ts                 # 31 Authentication tests
│   ├── providers.test.ts            # 12 Provider Profile tests
│   └── services.test.ts             # 23 Service Catalog tests
├── .env                             # Local environment variables (Git-ignored)
├── .env.example                     # Environment template (No secrets)
├── package.json                     # Scripts and dependencies
├── tsconfig.json                    # Base TypeScript compiler configuration
├── tsconfig.test.json               # Extended configuration for test typechecking
└── README.md                        # Full project documentation & API guide
```

---

## 6. Next Steps (Upcoming BUILD 04)

1. **Bookings System:** Design the Booking model linking customers, providers, and catalog services.
2. **Scheduling Engine:** Booking time-slot reservation, availability checks, and status management (`pending`, `confirmed`, `in_progress`, `completed`, `cancelled`).
3. **Contact Sharing:** Securely reveal provider phone and address to the customer upon booking confirmation.
