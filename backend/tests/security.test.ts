import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import app from "../src/app";
import { env, parseAllowedOrigins } from "../src/config/env";
import { corsHandler } from "../src/middleware/cors.middleware";
import { createRateLimiter } from "../src/middleware/rateLimit.middleware";
import { securityHeaders } from "../src/middleware/securityHeaders.middleware";
import { errorHandler } from "../src/middleware/errorHandler.middleware";
import { UserRole } from "../src/models/user.model";
import {
  checkTestDbSafety,
  clearTestDb,
  createAuthenticatedUser,
  getDbSkipReason,
  setupTestDb,
  teardownTestDb,
} from "./helpers/testDb";

checkTestDbSafety();
const dbSkipReason = getDbSkipReason();

function dbIt(name: string, fn: () => Promise<void> | void) {
  return it(name, { skip: dbSkipReason ?? undefined }, fn);
}

/**
 * Scan any response body recursively to ensure no sensitive fields or internal Mongo fields leak.
 */
function assertNoSensitiveData(body: unknown): void {
  const str = JSON.stringify(body);
  assert.ok(!str.includes("passwordHash"), "Response body must not contain passwordHash");
  assert.ok(!str.includes("$2a$"), "Response body must not contain bcrypt hash prefix $2a$");
  assert.ok(!str.includes("$2b$"), "Response body must not contain bcrypt hash prefix $2b$");
  if (process.env.JWT_SECRET) {
    assert.ok(!str.includes(process.env.JWT_SECRET), "Response body must not contain JWT secret");
  }

  // Recursive check for _id and __v
  function checkObject(obj: any) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(checkObject);
      return;
    }
    assert.strictEqual(obj._id, undefined, `Response object contains raw _id: ${JSON.stringify(obj)}`);
    assert.strictEqual(obj.__v, undefined, `Response object contains raw __v: ${JSON.stringify(obj)}`);
    for (const key of Object.keys(obj)) {
      checkObject(obj[key]);
    }
  }

  checkObject(body);
}

describe("BUILD 05 — Security Readiness Suite", () => {
  // ==========================================
  // PURE / NO-DB TESTS
  // ==========================================
  describe("1. CORS Configuration & Header Unit Tests (No DB)", () => {
    it("parseAllowedOrigins: parses valid URLs correctly", () => {
      assert.deepStrictEqual(parseAllowedOrigins(undefined), []);
      assert.deepStrictEqual(parseAllowedOrigins(""), []);
      assert.deepStrictEqual(
        parseAllowedOrigins("http://localhost:5173, https://app.example.com"),
        ["http://localhost:5173", "https://app.example.com"]
      );
    });

    it("parseAllowedOrigins: throws on wildcard '*'", () => {
      assert.throws(() => parseAllowedOrigins("*"), /Wildcard '\*' is not permitted/);
      assert.throws(() => parseAllowedOrigins("http://localhost:5173, *"), /Wildcard '\*' is not permitted/);
    });

    it("parseAllowedOrigins: throws on trailing slash or path", () => {
      assert.throws(() => parseAllowedOrigins("http://localhost:5173/"), /must not include a trailing slash/);
      assert.throws(() => parseAllowedOrigins("http://localhost:5173/app"), /must not include a path/);
    });

    it("parseAllowedOrigins: throws on invalid protocols", () => {
      assert.throws(() => parseAllowedOrigins("ftp://example.com"), /Only http: and https: are permitted/);
      assert.throws(() => parseAllowedOrigins("not-a-url"), /Invalid CORS origin/);
    });

    it("CORS Middleware: allowed origin receives CORS headers, 204 preflight, no credentials", async () => {
      const testApp = express();
      const allowedOrigin = "http://localhost:5173";
      // Temporarily inject allowed origin into env.CORS_ORIGINS
      const originalOrigins = [...env.CORS_ORIGINS];
      (env as any).CORS_ORIGINS = [allowedOrigin];

      testApp.use(corsHandler);
      testApp.get("/test", (_req, res) => res.json({ ok: true }));

      try {
        // Preflight OPTIONS request
        const preflight = await request(testApp)
          .options("/test")
          .set("Origin", allowedOrigin)
          .set("Access-Control-Request-Method", "POST");

        assert.strictEqual(preflight.status, 204);
        assert.strictEqual(preflight.headers["access-control-allow-origin"], allowedOrigin);
        assert.strictEqual(preflight.headers["vary"], "Origin");
        assert.ok(preflight.headers["access-control-allow-methods"]?.includes("POST"));
        assert.ok(preflight.headers["access-control-allow-headers"]?.includes("Authorization"));
        assert.strictEqual(preflight.headers["access-control-max-age"], "600");
        assert.strictEqual(preflight.headers["access-control-allow-credentials"], undefined);

        // Simple GET request with allowed origin
        const getRes = await request(testApp).get("/test").set("Origin", allowedOrigin);
        assert.strictEqual(getRes.status, 200);
        assert.strictEqual(getRes.headers["access-control-allow-origin"], allowedOrigin);
        assert.strictEqual(getRes.headers["vary"], "Origin");
      } finally {
        (env as any).CORS_ORIGINS = originalOrigins;
      }
    });

    it("CORS Middleware: disallowed origin receives no CORS headers", async () => {
      const testApp = express();
      testApp.use(corsHandler);
      testApp.get("/test", (_req, res) => res.json({ ok: true }));

      // Preflight from disallowed origin
      const preflight = await request(testApp)
        .options("/test")
        .set("Origin", "http://evil.com")
        .set("Access-Control-Request-Method", "POST");

      assert.strictEqual(preflight.status, 204);
      assert.strictEqual(preflight.headers["access-control-allow-origin"], undefined);

      // Simple request from disallowed origin
      const getRes = await request(testApp).get("/test").set("Origin", "http://evil.com");
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.headers["access-control-allow-origin"], undefined);
    });
  });

  describe("2. Security Headers & Production Hardening (No DB)", () => {
    it("Sets standard JSON API security headers on real app", async () => {
      const res = await request(app).get("/api/health");
      assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
      assert.strictEqual(res.headers["x-frame-options"], "DENY");
      assert.strictEqual(res.headers["referrer-policy"], "no-referrer");
      assert.strictEqual(res.headers["cross-origin-resource-policy"], "same-site");
      assert.strictEqual(res.headers["x-powered-by"], undefined);
    });

    it("Sets Strict-Transport-Security only in production mode", async () => {
      const testApp = express();
      testApp.use(securityHeaders);
      testApp.get("/ping", (_req, res) => res.send("pong"));

      // In non-production (test/dev)
      const devRes = await request(testApp).get("/ping");
      assert.strictEqual(devRes.headers["strict-transport-security"], undefined);

      // In production
      const originalEnv = env.NODE_ENV;
      (env as any).NODE_ENV = "production";
      try {
        const prodRes = await request(testApp).get("/ping");
        assert.strictEqual(
          prodRes.headers["strict-transport-security"],
          "max-age=15552000; includeSubDomains"
        );
      } finally {
        (env as any).NODE_ENV = originalEnv;
      }
    });

    it("Error handler suppresses stack traces when NODE_ENV is production", async () => {
      const testApp = express();
      testApp.get("/fail", () => {
        throw new Error("Simulated unhandled explosion");
      });
      testApp.use(errorHandler);

      const originalEnv = env.NODE_ENV;
      (env as any).NODE_ENV = "production";
      try {
        const res = await request(testApp).get("/fail");
        assert.strictEqual(res.status, 500);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.error.message, "Internal server error");
        assert.strictEqual(res.body.error.statusCode, 500);
        assert.strictEqual(res.body.error.stack, undefined, "Stack must never be present in production");
      } finally {
        (env as any).NODE_ENV = originalEnv;
      }
    });
  });

  describe("3. Rate Limiting Tests (No DB / Factory)", () => {
    it("Rate limiter enforces limits, returns 429 JSON with Retry-After and standard headers", async () => {
      const testApp = express();
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 2,
        message: "Too many requests, please try again later",
      });

      testApp.use(limiter);
      testApp.get("/limited", (_req, res) => res.json({ success: true }));

      // Request 1: success
      const res1 = await request(testApp).get("/limited");
      assert.strictEqual(res1.status, 200);

      // Request 2: success
      const res2 = await request(testApp).get("/limited");
      assert.strictEqual(res2.status, 200);

      // Request 3: rate limited
      const res3 = await request(testApp).get("/limited");
      assert.strictEqual(res3.status, 429);
      assert.strictEqual(res3.body.success, false);
      assert.strictEqual(res3.body.error.statusCode, 429);
      assert.strictEqual(res3.body.error.message, "Too many requests, please try again later");
      assert.ok(res3.headers["retry-after"], "Retry-After header must be present on 429");
      assert.ok(res3.headers["ratelimit-policy"] || res3.headers["ratelimit-remaining"] !== undefined);
      assert.strictEqual(res3.headers["x-ratelimit-limit"], undefined, "Legacy headers must be disabled");
    });

    it("GET /api/health is never blocked by rate limiting", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get("/api/health");
        assert.notStrictEqual(res.status, 429);
      }
    });
  });

  // ==========================================
  // DB-BACKED TESTS: SENSITIVE DATA EXPOSURE SCAN
  // ==========================================
  describe("4. Database-Backed Sensitive Data Exposure Scan", () => {
    before(async () => {
      if (dbSkipReason) return;
      const { isAvailable, skipReason } = await setupTestDb();
      if (!isAvailable) {
        throw new Error(`MongoDB not reachable: ${skipReason}`);
      }
    });

    after(async () => {
      await teardownTestDb();
    });

    beforeEach(async () => {
      await clearTestDb();
    });

    dbIt("Scans all route groups: auth, providers, services, bookings for leaked internals", async () => {
      // 1. Auth routes
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      const provider = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", customer.authHeader);
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(meRes.body);

      // 2. Provider routes
      const upsertRes = await request(app)
        .put("/api/providers/me")
        .set("Authorization", provider.authHeader)
        .send({
          providerType: "company",
          displayName: "QuickFix Appliances",
          phone: "9876543210",
          address: "123 Market St",
          city: "Bengaluru",
          description: "Reliable electronics and appliance repair.",
        });
      assert.strictEqual(upsertRes.status, 201);
      assert.strictEqual(upsertRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(upsertRes.body);

      const pubProvidersRes = await request(app).get("/api/providers");
      assert.strictEqual(pubProvidersRes.status, 200);
      assertNoSensitiveData(pubProvidersRes.body);

      // 3. Service routes
      const createServiceRes = await request(app)
        .post("/api/services")
        .set("Authorization", provider.authHeader)
        .send({
          title: "AC Deep Clean & Filter Service",
          description: "Complete cleaning and gas pressure check for split ACs.",
          category: "ac",
          basePrice: 799,
        });
      assert.strictEqual(createServiceRes.status, 201);
      assert.strictEqual(createServiceRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(createServiceRes.body);
      const serviceId = createServiceRes.body.data.service.id;

      const pubServicesRes = await request(app).get("/api/services");
      assert.strictEqual(pubServicesRes.status, 200);
      assertNoSensitiveData(pubServicesRes.body);

      // 4. Booking routes
      const scheduledDate = new Date(Date.now() + 86400000 * 2).toISOString();
      const createBookingRes = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send({
          serviceId,
          serviceAddress: "45 Palm Avenue, Koramangala",
          city: "Bengaluru",
          scheduledAt: scheduledDate,
          problemDescription: "AC not cooling properly.",
        });
      assert.strictEqual(createBookingRes.status, 201);
      assert.strictEqual(createBookingRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(createBookingRes.body);
      const bookingId = createBookingRes.body.data.booking.id;

      const getBookingRes = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set("Authorization", customer.authHeader);
      assert.strictEqual(getBookingRes.status, 200);
      assert.strictEqual(getBookingRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(getBookingRes.body);

      const listBookingsRes = await request(app)
        .get("/api/bookings/my")
        .set("Authorization", customer.authHeader);
      assert.strictEqual(listBookingsRes.status, 200);
      assert.strictEqual(listBookingsRes.headers["cache-control"], "no-store");
      assertNoSensitiveData(listBookingsRes.body);
    });

    dbIt("Duplicate registration returns 409 and does not leak index or internal Mongo details", async () => {
      const email = "duplicate_test@example.com";
      await request(app).post("/api/auth/register").send({
        name: "First User",
        email,
        password: "Password123",
        role: "customer",
      });

      const res = await request(app).post("/api/auth/register").send({
        name: "Second User",
        email,
        password: "Password123",
        role: "customer",
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.message, "Email is already registered");
      assert.strictEqual(res.body.error.statusCode, 409);
      assert.strictEqual(res.body.error.keyValue, undefined);
      assert.strictEqual(res.body.error.keyPattern, undefined);
    });

    it("Raw Mongo duplicate key (code 11000) in error handler returns 409 without index or keyValue internals", async () => {
      const testApp = express();
      testApp.get("/mongo-dup", (_req, _res, next) => {
        const err: any = new Error("E11000 duplicate key error collection: index: email_1 dup key: { email: 'test@example.com' }");
        err.code = 11000;
        err.keyPattern = { email: 1 };
        err.keyValue = { email: "test@example.com" };
        next(err);
      });
      testApp.use(errorHandler);

      const res = await request(testApp).get("/mongo-dup");
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.message, "Resource already exists");
      assert.strictEqual(res.body.error.statusCode, 409);
      assert.strictEqual(res.body.error.keyValue, undefined);
      assert.strictEqual(res.body.error.keyPattern, undefined);
    });
  });
});
