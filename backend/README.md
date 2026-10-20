# Service When Need — Backend

A REST API backend for the Service When Need marketplace, where customers can book technicians for home appliances and electronics.

Built with **Node.js**, **TypeScript**, **Express.js**, **MongoDB**, and **Mongoose**.

---

## Prerequisites

- **Node.js 20+** and **npm** (check with `node -v` and `npm -v`)
- A running **MongoDB** instance — either:
  - A local `mongod` process (default: `mongodb://127.0.0.1:27017`)
  - A [MongoDB Atlas](https://www.mongodb.com/atlas) connection string

---

## Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and fill in your real MONGODB_URI and JWT_SECRET
```

Generate a secure `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Important:** `.env` is git-ignored and must never be committed. It contains your real connection string and JWT secret. Only `.env.example` (which has no real credentials) is tracked by git.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Application environment (`development` \| `production` \| `test`) |
| `PORT` | No | `5000` | Port the HTTP server listens on (valid integer 1–65535) |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string. Server exits with code 1 if missing. |
| `JWT_SECRET` | **Yes** | — | Secret string for signing JWT tokens. Must be >= 32 characters. |
| `JWT_EXPIRES_IN` | No | `15m` | Token expiration time formatted as `<number><unit>` (e.g. `15m`, `1h`, `7d`). |
| `BCRYPT_SALT_ROUNDS` | No | `12` | Salt rounds for hashing passwords. Must be an integer between 10 and 14. |
| `MONGODB_URI_TEST` | Optional | — | MongoDB URI for running automated tests. Must end with `_test` and must not equal `MONGODB_URI`. |

---

## Development & Production Commands

```bash
# Start development server with auto-restart
npm run dev

# Type check application code
npm run typecheck

# Type check test files & application code
npm run typecheck:test

# Compile to production bundle (dist/)
npm run build

# Start production server
npm start
```

---

## Running Automated Tests

Tests use Node's built-in test runner (`node:test`) and `supertest`. To run tests against a real test database, supply `MONGODB_URI_TEST` inline:

```bash
# PowerShell
$env:MONGODB_URI_TEST="mongodb://127.0.0.1:27017/service-when-need_test"; npm test

# Bash / Linux / macOS
MONGODB_URI_TEST="mongodb://127.0.0.1:27017/service-when-need_test" npm test
```

### Safety Rules:
- The database name in `MONGODB_URI_TEST` **must** end in `_test`.
- `MONGODB_URI_TEST` must not equal `MONGODB_URI`.
- The test suite only wipes the `users`, `providerprofiles`, and `services` collections of the verified test connection; it never drops databases.
- If `MONGODB_URI_TEST` is unset, DB-dependent tests report `SKIPPED`, while no-DB unit tests (validations, formatting, pagination) still execute.

---

## API Endpoints & Permissions

### Authentication Endpoints (`/api/auth`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register customer or provider |
| POST | `/api/auth/login` | Public | Authenticate with email/password; returns JWT |
| GET | `/api/auth/me` | Authenticated | Current user profile |

### Provider Profile Endpoints (`/api/providers`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/providers/me` | Provider | Owner view of own profile (404 if none created yet) |
| PUT | `/api/providers/me` | Provider | Create (201) or replace (200) own profile |
| GET | `/api/providers` | Public | Paginated list of active providers; filters: `city`, `providerType`, `q`, `page`, `limit` |
| GET | `/api/providers/:id` | Public | Public provider profile; 404 if inactive or not found |

### Service Catalog Endpoints (`/api/services`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/services` | Provider | Create a service under caller's profile (201); 409 if no profile yet |
| GET | `/api/services/my` | Provider | List all caller's services (active and inactive), paginated |
| GET | `/api/services` | Public | Active services from active providers; filters: `category`, `city`, `q`, `page`, `limit` |
| GET | `/api/services/:id` | Public / Optional Auth | Public active service; owner can also view their own inactive service |
| PATCH | `/api/services/:id` | Provider (Owner) | Update `title`, `description`, `category`, `basePrice` |
| PATCH | `/api/services/:id/status` | Provider (Owner) | Toggle `isActive` (boolean) |

---

## Request & Response Examples

### 1. Upsert Provider Profile
`PUT /api/providers/me`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "providerType": "individual",
    "displayName": "Cooling Specialist",
    "phone": "+91 (987) 654-3210",
    "address": "42 Main Boulevard",
    "city": "Durgapur",
    "description": "10 years experience repairing home ACs and refrigerators"
  }
  ```
- **Response (`201 Created` / `200 OK`, `Cache-Control: no-store`):**
  ```json
  {
    "success": true,
    "data": {
      "provider": {
        "id": "67b6f3a1e2c34a0012345678",
        "providerType": "individual",
        "displayName": "Cooling Specialist",
        "phone": "+919876543210",
        "address": "42 Main Boulevard",
        "city": "Durgapur",
        "description": "10 years experience repairing home ACs and refrigerators",
        "isActive": true,
        "createdAt": "2026-10-20T10:00:00.000Z",
        "updatedAt": "2026-10-20T10:00:00.000Z"
      }
    }
  }
  ```

### 2. Create Service
`POST /api/services`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "title": "AC Complete Servicing & Gas Refill",
    "description": "Comprehensive high pressure wash and refrigerant refill for split AC units",
    "category": "ac",
    "basePrice": 599.50
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
        "title": "AC Complete Servicing & Gas Refill",
        "description": "Comprehensive high pressure wash and refrigerant refill for split AC units",
        "category": "ac",
        "basePrice": 599.50,
        "isActive": true,
        "createdAt": "2026-10-20T10:05:00.000Z",
        "updatedAt": "2026-10-20T10:05:00.000Z"
      }
    }
  }
  ```

### 3. Public Service Browsing with Filters
`GET /api/services?category=ac&city=durgapur&q=gas&page=1&limit=10`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "67b6f3a1e2c34a0087654321",
          "title": "AC Complete Servicing & Gas Refill",
          "description": "Comprehensive high pressure wash and refrigerant refill for split AC units",
          "category": "ac",
          "basePrice": 599.50,
          "createdAt": "2026-10-20T10:05:00.000Z",
          "provider": {
            "id": "67b6f3a1e2c34a0012345678",
            "providerType": "individual",
            "displayName": "Cooling Specialist",
            "city": "Durgapur"
          }
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 10,
        "total": 1,
        "totalPages": 1
      }
    }
  }
  ```

---

## Service Categories & Validation Rules

- **Allowed Categories:** `ac`, `refrigerator`, `fan`, `computer`, `mobile`, `other` (case-insensitive on query and input, lowercased in database).
- **Base Price:** Number, `>= 0`, `<= 10,000,000`, maximum 2 decimal places. Numeric strings are rejected. Currency is not modeled in this build.
- **Pagination Defaults & Bounds:**
  - `page`: default `1`, maximum `10,000` (must be a positive integer).
  - `limit`: default `10`, maximum `50` (must be a positive integer).
- **Search Query (`q`):** Case-insensitive literal substring search with regex special characters escaped.
- **Ownership:** Service ownership is strictly derived from the caller's verified provider profile; client-supplied `provider` or `providerId` in the body is completely ignored.
- **Public vs Private Fields:** Public endpoints never expose `phone`, `address`, user IDs, or email addresses. Contact details will be made available only after booking confirmation in a future build.

---

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts                   # Validates and loads all environment variables
│   │   └── database.ts              # MongoDB connection management & retries
│   ├── controllers/
│   │   ├── auth.controller.ts       # Auth handlers (register, login, me)
│   │   ├── health.controller.ts     # Health check handler
│   │   ├── provider.controller.ts   # Provider profile handlers
│   │   └── service.controller.ts    # Service catalog handlers
│   ├── middleware/
│   │   ├── auth.middleware.ts       # authenticate, optionalAuthenticate, authorizeRoles
│   │   ├── errorHandler.middleware.ts # Central error handler
│   │   └── notFound.middleware.ts   # 404 handler for unknown routes
│   ├── models/
│   │   ├── providerProfile.model.ts # ProviderProfile schema, types, serializers
│   │   ├── service.model.ts         # Service schema, categories, serializers
│   │   └── user.model.ts            # User schema, roles, safe serializer
│   ├── routes/
│   │   ├── auth.routes.ts           # Mounted at /api/auth
│   │   ├── health.routes.ts         # Mounted at /api/health
│   │   ├── index.ts                 # Aggregates sub-routers
│   │   ├── provider.routes.ts       # Mounted at /api/providers
│   │   └── service.routes.ts        # Mounted at /api/services
│   ├── services/
│   │   ├── auth.service.ts          # Auth business logic
│   │   ├── catalog.service.ts       # Catalog & service business logic
│   │   └── provider.service.ts      # Provider profile business logic
│   ├── types/
│   │   └── express.d.ts             # Express Request augmentation (req.user)
│   ├── utils/
│   │   ├── AppError.ts              # Operational error class with statusCode
│   │   └── validation.ts            # Hand-written input & query validators
│   ├── app.ts                       # Express application wiring & middleware
│   └── server.ts                    # HTTP server entrypoint and graceful shutdown
├── tests/
│   ├── helpers/
│   │   └── testDb.ts                # Test DB safety guards & connection helpers
│   ├── auth.test.ts                 # 31 auth unit & integration tests
│   ├── providers.test.ts            # 12 provider profile tests (3 unit + 9 integration)
│   └── services.test.ts             # 23 service catalog tests (3 unit + 20 integration)
├── .env.example                     # Environment template (no secrets)
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.test.json
└── README.md
```

---

## Known Limitations

- **No Delete Endpoints:** Inactivation via `PATCH /api/services/:id/status` (`isActive: false`) serves as the removal mechanism in this build.
- **No Admin Moderation or Admin Dashboard:** Provider and service management is self-service for authenticated providers in this build.
- **No Image/File Uploads:** Service images and provider avatar uploads are deferred to future builds.
- **Currency Unmodeled:** Prices are stored as numbers without currency specification.
- **Simple Regex Search:** Search parameter `q` uses escaped case-insensitive regex filtering, not full-text search.
- **Hidden Provider Contact Details:** Phone number and full street address are intentionally withheld from public browsing endpoints.
- **Database Buffering on Outage:** Under unreachable database conditions, MongoDB operations buffer for up to 10 seconds before failing with an operational 500 error.
