import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import app from "../src/app";
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

function assertErrorShape(body: any, expectedStatus: number): void {
  assert.strictEqual(body.success, false, "Error response must have success: false");
  assert.ok(body.error, "Error response must have error object");
  assert.strictEqual(typeof body.error.message, "string", "error.message must be a string");
  assert.strictEqual(body.error.statusCode, expectedStatus, `error.statusCode must be ${expectedStatus}`);
}

function assertPaginationShape(pagination: any): void {
  assert.ok(pagination, "Pagination object must be present");
  assert.strictEqual(typeof pagination.page, "number", "pagination.page must be a number");
  assert.strictEqual(typeof pagination.limit, "number", "pagination.limit must be a number");
  assert.strictEqual(typeof pagination.total, "number", "pagination.total must be a number");
  assert.strictEqual(typeof pagination.totalPages, "number", "pagination.totalPages must be a number");
  assert.ok(pagination.page >= 1, "page must be >= 1");
  assert.ok(pagination.limit >= 1 && pagination.limit <= 50, "limit must be between 1 and 50");
}

describe("BUILD 05 — API Consistency Suite", () => {
  // ==========================================
  // PURE / NO-DB TESTS: ERROR SHAPES & UNKNOWN ROUTES
  // ==========================================
  describe("1. Error Shapes & HTTP Conventions (No DB)", () => {
    it("404 Route Not Found has consistent error shape", async () => {
      const res = await request(app).get("/api/non-existent-endpoint");
      assert.strictEqual(res.status, 404);
      assertErrorShape(res.body, 404);
    });

    it("404 Unknown method on known path has consistent error shape", async () => {
      const res = await request(app).delete("/api/health");
      assert.strictEqual(res.status, 404);
      assertErrorShape(res.body, 404);
    });

    it("400 Malformed JSON body has consistent error shape", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send("{ malformed: json ");
      assert.strictEqual(res.status, 400);
      assertErrorShape(res.body, 400);
      assert.strictEqual(res.body.error.message, "Invalid JSON in request body");
    });

    it("413 Oversized body has consistent error shape", async () => {
      // JSON limit is 10kb
      const hugeBody = { data: "x".repeat(12 * 1024) };
      const res = await request(app)
        .post("/api/auth/login")
        .send(hugeBody);
      assert.strictEqual(res.status, 413);
      assertErrorShape(res.body, 413);
      assert.strictEqual(res.body.error.message, "Request body too large");
    });

    it("401 Unauthenticated request has consistent error shape", async () => {
      const res = await request(app).get("/api/auth/me");
      assert.strictEqual(res.status, 401);
      assertErrorShape(res.body, 401);
    });
  });

  // ==========================================
  // DB-BACKED TESTS: LIST AND PAGINATION SHAPES
  // ==========================================
  describe("2. Cross-Route List & Pagination Consistency", () => {
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

    dbIt("403 Forbidden role on restricted endpoint has consistent error shape", async () => {
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      // Customers cannot access provider-only /api/providers/me (PUT)
      const res = await request(app)
        .put("/api/providers/me")
        .set("Authorization", customer.authHeader)
        .send({
          providerType: "individual",
          displayName: "Technician Jane",
          phone: "9876543210",
          address: "456 Elm St",
          city: "Bengaluru",
        });
      assert.strictEqual(res.status, 403);
      assertErrorShape(res.body, 403);
    });

    dbIt("Verifies list & pagination response shape across all list endpoints", async () => {
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      const provider = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      // Create profile & service for data
      await request(app)
        .put("/api/providers/me")
        .set("Authorization", provider.authHeader)
        .send({
          providerType: "individual",
          displayName: "Alpha Repairs",
          phone: "9988776655",
          address: "789 Pine Road",
          city: "Bengaluru",
        });

      await request(app)
        .post("/api/services")
        .set("Authorization", provider.authHeader)
        .send({
          title: "Refrigerator Gas Top-Up",
          description: "Eco-friendly gas charging for single & double door fridges.",
          category: "refrigerator",
          basePrice: 1200,
        });

      // 1. GET /api/providers (public list)
      const providersRes = await request(app).get("/api/providers?page=1&limit=10");
      assert.strictEqual(providersRes.status, 200);
      assert.strictEqual(providersRes.body.success, true);
      assert.ok(Array.isArray(providersRes.body.data.items));
      assertPaginationShape(providersRes.body.data.pagination);

      // 2. GET /api/services (public list)
      const servicesRes = await request(app).get("/api/services?page=1&limit=10");
      assert.strictEqual(servicesRes.status, 200);
      assert.strictEqual(servicesRes.body.success, true);
      assert.ok(Array.isArray(servicesRes.body.data.items));
      assertPaginationShape(servicesRes.body.data.pagination);

      // 3. GET /api/services/my (provider list)
      const myServicesRes = await request(app)
        .get("/api/services/my?page=1&limit=10")
        .set("Authorization", provider.authHeader);
      assert.strictEqual(myServicesRes.status, 200);
      assert.strictEqual(myServicesRes.body.success, true);
      assert.ok(Array.isArray(myServicesRes.body.data.items));
      assertPaginationShape(myServicesRes.body.data.pagination);

      // 4. GET /api/bookings/my (customer list)
      const bookingsRes = await request(app)
        .get("/api/bookings/my?page=1&limit=10")
        .set("Authorization", customer.authHeader);
      assert.strictEqual(bookingsRes.status, 200);
      assert.strictEqual(bookingsRes.body.success, true);
      assert.ok(Array.isArray(bookingsRes.body.data.items));
      assertPaginationShape(bookingsRes.body.data.pagination);
    });

    dbIt("Enforces pagination constraints across list endpoints (page default 1 max 10000, limit default 10 max 50)", async () => {
      // Negative page -> 400
      const badPage = await request(app).get("/api/providers?page=0");
      assert.strictEqual(badPage.status, 400);
      assertErrorShape(badPage.body, 400);

      // Page > 10000 -> 400
      const excessivePage = await request(app).get("/api/providers?page=10001");
      assert.strictEqual(excessivePage.status, 400);
      assertErrorShape(excessivePage.body, 400);

      // Limit > 50 -> 400
      const excessiveLimit = await request(app).get("/api/providers?limit=51");
      assert.strictEqual(excessiveLimit.status, 400);
      assertErrorShape(excessiveLimit.body, 400);
    });
  });
});
