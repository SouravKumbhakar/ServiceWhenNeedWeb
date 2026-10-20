import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import app from "../src/app";
import { ProviderProfile, ProviderType } from "../src/models/providerProfile.model";
import { Service, SERVICE_CATEGORIES } from "../src/models/service.model";
import { UserRole } from "../src/models/user.model";
import {
  escapeRegex,
  parsePaginationParams,
  validateBasePrice,
  validateCreateServiceBody,
  validateServiceListQuery,
} from "../src/utils/validation";
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

function assertNoSensitiveData(body: unknown): void {
  const str = JSON.stringify(body);
  assert.ok(!str.includes("passwordHash"), "Must not leak passwordHash");
  assert.ok(!str.includes("$2a$"), "Must not leak bcrypt hash");
  assert.ok(!str.includes("$2b$"), "Must not leak bcrypt hash");
  if (process.env.JWT_SECRET) {
    assert.ok(!str.includes(process.env.JWT_SECRET), "Must not leak JWT_SECRET");
  }
}

describe("BUILD 03 — Service Catalog Suite", () => {
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

  // ========================================================
  // NO-DB UNIT TESTS (Pure validation checks, runs without DB)
  // ========================================================
  describe("Service Validation (No-DB Unit Tests)", () => {
    it("Regex escaping handles special characters without throwing", () => {
      assert.equal(escapeRegex("a.*("), "a\\.\\*\\(");
      assert.equal(escapeRegex("[test]?+"), "\\[test\\]\\?\\+");
    });

    it("Base price validation enforces non-negative numbers and decimal places", () => {
      assert.equal(validateBasePrice(150.5), 150.5);
      assert.equal(validateBasePrice(0), 0);
      assert.equal(validateBasePrice(100.99), 100.99);

      assert.throws(() => validateBasePrice(-10), /cannot be negative/);
      assert.throws(() => validateBasePrice(100.999), /at most 2 decimal places/);
      assert.throws(() => validateBasePrice(10000001), /cannot exceed 10000000/);
      assert.throws(() => validateBasePrice("150" as any), /must be a number/);
      assert.throws(() => validateBasePrice(NaN), /must be a number/);
    });

    it("Pagination validation handles valid bounds and rejects out of range values", () => {
      assert.deepEqual(parsePaginationParams({ page: "3", limit: "25" }), { page: 3, limit: 25 });
      assert.deepEqual(parsePaginationParams({}), { page: 1, limit: 10 });

      assert.throws(() => parsePaginationParams({ page: "0" }), /between 1 and 10000/);
      assert.throws(() => parsePaginationParams({ limit: "51" }), /between 1 and 50/);
      assert.throws(() => parsePaginationParams({ limit: "0" }), /between 1 and 50/);
      assert.throws(() => parsePaginationParams({ page: "abc" }), /positive integer/);
    });
  });

  // ========================================================
  // DB-BACKED INTEGRATION TESTS (Cases 10 - 29)
  // ========================================================
  describe("Services CRUD, Ownership, and Filtering", () => {
    dbIt("10. Provider with profile can create service -> 201 with providerId; active by default", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const profRes = await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "AC Hero",
        phone: "9876543210",
        address: "123 Cool St",
        city: "Kolkata",
      });
      const providerId = profRes.body.data.provider.id;

      const res = await request(app)
        .post("/api/services")
        .set("Authorization", p.authHeader)
        .send({
          title: "AC Master Cleaning",
          description: "Full deep foam cleaning for split air conditioners",
          category: "ac",
          basePrice: 499.5,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const svc = res.body.data.service;
      assert.ok(svc.id);
      assert.equal(svc.providerId, providerId);
      assert.equal(svc.title, "AC Master Cleaning");
      assert.equal(svc.category, "ac");
      assert.equal(svc.basePrice, 499.5);
      assert.equal(svc.isActive, true);

      assertNoSensitiveData(res.body);
    });

    dbIt("11. Provider without profile -> 409 on POST /api/services", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      const res = await request(app)
        .post("/api/services")
        .set("Authorization", p.authHeader)
        .send({
          title: "AC Cleaning",
          description: "Full deep foam cleaning for split air conditioners",
          category: "ac",
          basePrice: 500,
        });

      assert.equal(res.status, 409);
      assert.equal(res.body.error.message, "Create your provider profile before managing services");
    });

    dbIt("12. Customer/admin -> 403; no/invalid token -> 401", async () => {
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      const custRes = await request(app)
        .post("/api/services")
        .set("Authorization", customer.authHeader)
        .send({ title: "Any", description: "Any 1234567890", category: "ac", basePrice: 100 });
      assert.equal(custRes.status, 403);

      const noToken = await request(app).post("/api/services").send({ title: "Any" });
      assert.equal(noToken.status, 401);

      const badToken = await request(app)
        .post("/api/services")
        .set("Authorization", "Bearer invalid")
        .send({ title: "Any" });
      assert.equal(badToken.status, 401);
    });

    dbIt("13. Client-supplied provider/providerId in body is ignored; created under caller profile", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const profRes = await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Real Owner",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      const realProviderId = profRes.body.data.provider.id;

      const res = await request(app)
        .post("/api/services")
        .set("Authorization", p.authHeader)
        .send({
          title: "Fan Repair",
          description: "High speed ceiling fan winding repair",
          category: "fan",
          basePrice: 200,
          provider: "67b6f3a1e2c34a0099999999",
          providerId: "67b6f3a1e2c34a0099999999",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.service.providerId, realProviderId);
    });

    dbIt("14. Invalid creation inputs -> 400", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Valid Provider",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });

      // Bad category
      const badCat = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "spaceship",
        basePrice: 100,
      });
      assert.equal(badCat.status, 400);

      // Negative price
      const negPrice = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "ac",
        basePrice: -50,
      });
      assert.equal(negPrice.status, 400);

      // Price > max
      const overMax = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "ac",
        basePrice: 10000001,
      });
      assert.equal(overMax.status, 400);

      // > 2 decimals
      const decimals = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "ac",
        basePrice: 99.999,
      });
      assert.equal(decimals.status, 400);

      // Numeric string price
      const strPrice = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "ac",
        basePrice: "100",
      });
      assert.equal(strPrice.status, 400);

      // Missing title / description
      const noTitle = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        description: "Valid description here",
        category: "ac",
        basePrice: 100,
      });
      assert.equal(noTitle.status, 400);

      // Too short title (< 3)
      const shortTitle = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "AC",
        description: "Valid description here",
        category: "ac",
        basePrice: 100,
      });
      assert.equal(shortTitle.status, 400);

      // isActive as string
      const strActive = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Test Service",
        description: "Valid description here",
        category: "ac",
        basePrice: 100,
        isActive: "true",
      });
      assert.equal(strActive.status, 400);
    });

    dbIt("15. GET /api/services/my returns caller services only (active and inactive)", async () => {
      // Provider A creates 2 services (1 active, 1 inactive)
      const pA = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pA.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider A",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      await request(app).post("/api/services").set("Authorization", pA.authHeader).send({
        title: "Service A1",
        description: "Description A1 123456",
        category: "ac",
        basePrice: 100,
        isActive: true,
      });
      await request(app).post("/api/services").set("Authorization", pA.authHeader).send({
        title: "Service A2",
        description: "Description A2 123456",
        category: "fan",
        basePrice: 150,
        isActive: false,
      });

      // Provider B creates 1 service
      const pB = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pB.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider B",
        phone: "9876543211",
        address: "456 St",
        city: "City",
      });
      await request(app).post("/api/services").set("Authorization", pB.authHeader).send({
        title: "Service B1",
        description: "Description B1 123456",
        category: "mobile",
        basePrice: 200,
      });

      // Call GET /api/services/my as Provider A
      const resA = await request(app).get("/api/services/my").set("Authorization", pA.authHeader);
      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.items.length, 2);
      assert.equal(resA.body.data.pagination.total, 2);
      const titlesA = resA.body.data.items.map((i: any) => i.title);
      assert.ok(titlesA.includes("Service A1"));
      assert.ok(titlesA.includes("Service A2"));
      assert.ok(!titlesA.includes("Service B1"));
    });

    dbIt("16. PATCH /api/services/:id updates allowed fields; empty/unknown body -> 400; isActive ignored", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider Patch",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      const createRes = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Original Title",
        description: "Original description 123456",
        category: "ac",
        basePrice: 300,
        isActive: true,
      });
      const svcId = createRes.body.data.service.id;

      // Update allowed fields
      const patchRes = await request(app)
        .patch(`/api/services/${svcId}`)
        .set("Authorization", p.authHeader)
        .send({
          title: "Updated Title",
          basePrice: 350,
          isActive: false, // Must be ignored
        });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.service.title, "Updated Title");
      assert.equal(patchRes.body.data.service.basePrice, 350);
      assert.equal(patchRes.body.data.service.isActive, true); // Still true!

      // Empty body -> 400
      const emptyRes = await request(app)
        .patch(`/api/services/${svcId}`)
        .set("Authorization", p.authHeader)
        .send({});
      assert.equal(emptyRes.status, 400);

      // Body with only unknown fields -> 400
      const unknownRes = await request(app)
        .patch(`/api/services/${svcId}`)
        .set("Authorization", p.authHeader)
        .send({ unknownField: "xyz" });
      assert.equal(unknownRes.status, 400);
    });

    dbIt("17. Provider B cannot PATCH or change status of Provider A service -> 404 and unchanged", async () => {
      const pA = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pA.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider Alpha",
        phone: "9876543210",
        address: "123 Street Alpha",
        city: "City",
      });
      const svcA = await request(app).post("/api/services").set("Authorization", pA.authHeader).send({
        title: "Service A",
        description: "Description A 12345678",
        category: "ac",
        basePrice: 100,
      });
      const svcId = svcA.body.data.service.id;

      const pB = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pB.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider Beta",
        phone: "9876543211",
        address: "456 Street Beta",
        city: "City",
      });

      // Provider B tries to PATCH
      const patchRes = await request(app)
        .patch(`/api/services/${svcId}`)
        .set("Authorization", pB.authHeader)
        .send({ title: "Hacked Title" });
      assert.equal(patchRes.status, 404);

      // Provider B tries to change status
      const statusRes = await request(app)
        .patch(`/api/services/${svcId}/status`)
        .set("Authorization", pB.authHeader)
        .send({ isActive: false });
      assert.equal(statusRes.status, 404);

      // Verify in DB that Service A is unchanged
      const freshA = await Service.findById(svcId);
      assert.ok(freshA);
      assert.equal(freshA.title, "Service A");
      assert.equal(freshA.isActive, true);
    });

    dbIt("18. PATCH /api/services/:id/status toggles isActive for owner; non-boolean -> 400; invalid id -> 400", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Toggle Provider",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      const svcRes = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Toggle Svc",
        description: "Description toggle 1234",
        category: "ac",
        basePrice: 100,
      });
      const svcId = svcRes.body.data.service.id;

      // Deactivate
      const deact = await request(app)
        .patch(`/api/services/${svcId}/status`)
        .set("Authorization", p.authHeader)
        .send({ isActive: false });
      assert.equal(deact.status, 200);
      assert.equal(deact.body.data.service.isActive, false);

      // Reactivate
      const react = await request(app)
        .patch(`/api/services/${svcId}/status`)
        .set("Authorization", p.authHeader)
        .send({ isActive: true });
      assert.equal(react.status, 200);
      assert.equal(react.body.data.service.isActive, true);

      // Non-boolean value -> 400
      const badBool = await request(app)
        .patch(`/api/services/${svcId}/status`)
        .set("Authorization", p.authHeader)
        .send({ isActive: "false" });
      assert.equal(badBool.status, 400);

      // Invalid id -> 400
      const badId = await request(app)
        .patch("/api/services/not-an-id/status")
        .set("Authorization", p.authHeader)
        .send({ isActive: false });
      assert.equal(badId.status, 400);
    });

    dbIt("19. Customer token on PATCH routes -> 403", async () => {
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      const patchRes = await request(app)
        .patch("/api/services/67b6f3a1e2c34a0011111111")
        .set("Authorization", customer.authHeader)
        .send({ title: "Any" });
      assert.equal(patchRes.status, 403);

      const statusRes = await request(app)
        .patch("/api/services/67b6f3a1e2c34a0011111111/status")
        .set("Authorization", customer.authHeader)
        .send({ isActive: false });
      assert.equal(statusRes.status, 403);
    });

    dbIt("20. GET /api/services is public, returns active services with nested provider summary; no phone/address", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Public Provider",
        phone: "9876543210",
        address: "Top Secret Address",
        city: "Siliguri",
      });
      await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Refrigerator Gas Filling",
        description: "Complete vacuum and original refrigerant gas refill",
        category: "refrigerator",
        basePrice: 750,
      });

      const res = await request(app).get("/api/services");
      assert.equal(res.status, 200);
      assert.equal(res.body.data.items.length, 1);
      const item = res.body.data.items[0];
      assert.equal(item.title, "Refrigerator Gas Filling");
      assert.ok(item.provider);
      assert.equal(item.provider.displayName, "Public Provider");
      assert.equal(item.provider.city, "Siliguri");

      // Verify no phone, address, user id, or email anywhere
      assert.equal((item.provider as any).phone, undefined);
      assert.equal((item.provider as any).address, undefined);
      assert.equal((item.provider as any).user, undefined);
      assert.equal((item as any).phone, undefined);
      assert.equal((item as any).address, undefined);
    });

    dbIt("21. Inactive service is absent from public list; 404 for anonymous/others, 200 for owner", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider Active",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      const svcRes = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Inactive Service",
        description: "Valid description here 123",
        category: "ac",
        basePrice: 500,
        isActive: false,
      });
      const svcId = svcRes.body.data.service.id;

      // 1. Absent from public GET /api/services
      const listRes = await request(app).get("/api/services");
      assert.equal(listRes.body.data.items.length, 0);

      // 2. Anonymous GET /api/services/:id -> 404
      const anonRes = await request(app).get(`/api/services/${svcId}`);
      assert.equal(anonRes.status, 404);

      // 3. Other provider GET /api/services/:id -> 404
      const otherP = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const otherRes = await request(app)
        .get(`/api/services/${svcId}`)
        .set("Authorization", otherP.authHeader);
      assert.equal(otherRes.status, 404);

      // 4. Owner GET /api/services/:id -> 200
      const ownerRes = await request(app)
        .get(`/api/services/${svcId}`)
        .set("Authorization", p.authHeader);
      assert.equal(ownerRes.status, 200);
      assert.equal(ownerRes.body.data.service.id, svcId);
    });

    dbIt("22. Service whose provider profile is inactive is hidden from public list and GET /services/:id", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const profRes = await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "To Be Inactive Provider",
        phone: "9876543210",
        address: "123 St",
        city: "City",
      });
      const svcRes = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Active Service From Inactive Provider",
        description: "Valid description here 123",
        category: "ac",
        basePrice: 500,
      });
      const svcId = svcRes.body.data.service.id;

      // Deactivate provider profile in DB
      await ProviderProfile.findByIdAndUpdate(profRes.body.data.provider.id, { isActive: false });

      const listRes = await request(app).get("/api/services");
      assert.equal(listRes.body.data.items.length, 0);

      const detailRes = await request(app).get(`/api/services/${svcId}`);
      assert.equal(detailRes.status, 404);
    });

    dbIt("23. Filters: category, case-insensitive city, case-insensitive regex q with special chars", async () => {
      // Provider in Kolkata
      const pKolkata = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pKolkata.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Kolkata Tech",
        phone: "9876543210",
        address: "123 Street Kolkata",
        city: "Kolkata",
      });
      await request(app).post("/api/services").set("Authorization", pKolkata.authHeader).send({
        title: "Special AC (Split)",
        description: "Expert ac cleaning and repair with a.*( warranty",
        category: "ac",
        basePrice: 500,
      });

      // Provider in Durgapur
      const pDurgapur = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", pDurgapur.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Durgapur Tech",
        phone: "9876543211",
        address: "456 Street Durgapur",
        city: "Durgapur",
      });
      await request(app).post("/api/services").set("Authorization", pDurgapur.authHeader).send({
        title: "Mobile Screen Repair",
        description: "OLED display replacement",
        category: "mobile",
        basePrice: 1200,
      });

      // Filter by category
      const catRes = await request(app).get("/api/services?category=ac");
      assert.equal(catRes.status, 200);
      assert.equal(catRes.body.data.items.length, 1);
      assert.equal(catRes.body.data.items[0].category, "ac");

      // Bad category -> 400
      const badCatRes = await request(app).get("/api/services?category=unknown");
      assert.equal(badCatRes.status, 400);

      // Filter by city (case-insensitive)
      const cityRes = await request(app).get("/api/services?city=DuRgApUr");
      assert.equal(cityRes.status, 200);
      assert.equal(cityRes.body.data.items.length, 1);
      assert.equal(cityRes.body.data.items[0].title, "Mobile Screen Repair");

      // Filter by q with regex special chars "a.*("
      const qRes = await request(app).get("/api/services?q=a.*(");
      assert.equal(qRes.status, 200);
      assert.equal(qRes.body.data.items.length, 1);
      assert.equal(qRes.body.data.items[0].title, "Special AC (Split)");

      // Combined filters
      const combRes = await request(app).get("/api/services?category=ac&city=kolkata&q=split");
      assert.equal(combRes.status, 200);
      assert.equal(combRes.body.data.items.length, 1);
    });

    dbIt("24. Query-string injection attempts -> 400", async () => {
      const objCat = await request(app).get("/api/services?category[$ne]=ac");
      assert.equal(objCat.status, 400);

      const objQ = await request(app).get("/api/services?q[$regex]=.*");
      assert.equal(objQ.status, 400);

      const objPage = await request(app).get("/api/services?page[$gt]=1");
      assert.equal(objPage.status, 400);

      const repeatedCat = await request(app).get("/api/services?category=ac&category=fan");
      assert.equal(repeatedCat.status, 400);
    });

    dbIt("25. Pagination: limits, pages, no duplicates (stable sort), invalid page/limit -> 400", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Batch Provider",
        phone: "9876543210",
        address: "123 Street Batch",
        city: "City",
      });

      // Create 3 services
      for (let i = 1; i <= 3; i++) {
        await request(app).post("/api/services").set("Authorization", p.authHeader).send({
          title: `Service Number ${i}`,
          description: `Description for service ${i} 123456`,
          category: "ac",
          basePrice: 100 * i,
        });
      }

      // Page 1 with limit 2
      const p1Res = await request(app).get("/api/services?page=1&limit=2");
      assert.equal(p1Res.status, 200);
      assert.equal(p1Res.body.data.items.length, 2);
      assert.equal(p1Res.body.data.pagination.total, 3);
      assert.equal(p1Res.body.data.pagination.totalPages, 2);

      // Page 2 with limit 2
      const p2Res = await request(app).get("/api/services?page=2&limit=2");
      assert.equal(p2Res.status, 200);
      assert.equal(p2Res.body.data.items.length, 1);

      // Verify no duplicates across pages
      const idsP1 = p1Res.body.data.items.map((i: any) => i.id);
      const idsP2 = p2Res.body.data.items.map((i: any) => i.id);
      assert.ok(!idsP1.includes(idsP2[0]));

      // Invalid pagination params
      assert.equal((await request(app).get("/api/services?limit=0")).status, 400);
      assert.equal((await request(app).get("/api/services?limit=51")).status, 400);
      assert.equal((await request(app).get("/api/services?page=0")).status, 400);
      assert.equal((await request(app).get("/api/services?page=-1")).status, 400);
      assert.equal((await request(app).get("/api/services?page=abc")).status, 400);
    });

    dbIt("26. GET /api/services/:id with invalid ObjectId -> 400, unknown -> 404, malformed token -> 401", async () => {
      // Invalid ObjectId
      const badId = await request(app).get("/api/services/short-id");
      assert.equal(badId.status, 400);

      // Unknown ObjectId
      const unknownId = await request(app).get("/api/services/67b6f3a1e2c34a0011111111");
      assert.equal(unknownId.status, 404);

      // Malformed token on optional-auth route -> 401
      const badAuth = await request(app)
        .get("/api/services/67b6f3a1e2c34a0011111111")
        .set("Authorization", "Bearer garbage-token");
      assert.equal(badAuth.status, 401);
      assert.equal(badAuth.body.error.message, "Invalid token");
    });

    dbIt("27. Route ordering regression: /my and /me are not captured by /:id", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      // GET /api/services/my must not return 400 "Invalid service id"
      const myRes = await request(app).get("/api/services/my").set("Authorization", p.authHeader);
      assert.notEqual(myRes.status, 400);
      assert.equal(myRes.status, 200);

      // GET /api/providers/me must not return 400 "Invalid provider id"
      const meRes = await request(app).get("/api/providers/me").set("Authorization", p.authHeader);
      assert.notEqual(meRes.status, 400);
      assert.ok(meRes.status === 200 || meRes.status === 404);
    });

    dbIt("28. Regression: /api/health still returns JSON, 404 format holds, bad JSON returns 400", async () => {
      const health = await request(app).get("/api/health");
      assert.ok(health.status === 200 || health.status === 503);
      assert.ok(health.body.status !== undefined);

      const notFound = await request(app).get("/api/unknown-route-1234");
      assert.equal(notFound.status, 404);
      assert.equal(notFound.body.success, false);

      const badJson = await request(app)
        .post("/api/services")
        .set("Content-Type", "application/json")
        .send("{ bad json");
      assert.equal(badJson.status, 400);
      assert.equal(badJson.body.error.message, "Invalid JSON in request body");
    });

    dbIt("29. Sensitive data leakage prevention check across new endpoints", async () => {
      const p = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const prof = await request(app).put("/api/providers/me").set("Authorization", p.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Leak Checker",
        phone: "9876543210",
        address: "Address",
        city: "City",
      });
      assertNoSensitiveData(prof.body);

      const svc = await request(app).post("/api/services").set("Authorization", p.authHeader).send({
        title: "Check Svc",
        description: "Description 12345678",
        category: "ac",
        basePrice: 100,
      });
      assertNoSensitiveData(svc.body);

      const list = await request(app).get("/api/services");
      assertNoSensitiveData(list.body);
    });
  });
});
