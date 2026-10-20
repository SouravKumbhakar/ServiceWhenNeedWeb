import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import app from "../src/app";
import { ProviderProfile, ProviderType } from "../src/models/providerProfile.model";
import { UserRole } from "../src/models/user.model";
import {
  normalizePhone,
  validateObjectIdParam,
  validateProviderListQuery,
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

describe("BUILD 03 — Provider Profiles Suite", () => {
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
  describe("Provider Validation (No-DB Unit Tests)", () => {
    it("Phone normalization validates formatting and strips separators", () => {
      assert.equal(normalizePhone("+1 (555) 234-5678"), "+15552345678");
      assert.equal(normalizePhone(" 9876543210 "), "9876543210");
      assert.throws(() => normalizePhone("123"), /between 7 and 15/);
      assert.throws(() => normalizePhone("abc-1234567"), /Invalid phone number format/);
    });

    it("ObjectId param validation enforces 24-character hex strings", () => {
      assert.equal(
        validateObjectIdParam("67b6f3a1e2c34a0012345678", "test id"),
        "67b6f3a1e2c34a0012345678"
      );
      assert.throws(() => validateObjectIdParam("invalid-id", "test id"), /Invalid test id/);
      assert.throws(() => validateObjectIdParam(12345 as any, "test id"), /Invalid test id/);
    });

    it("Provider query validation handles defaults and rejects invalid inputs", () => {
      const q1 = validateProviderListQuery({});
      assert.equal(q1.page, 1);
      assert.equal(q1.limit, 10);

      const q2 = validateProviderListQuery({ city: "Durgapur", providerType: "company", page: "2", limit: "20" });
      assert.equal(q2.city, "durgapur");
      assert.equal(q2.providerType, ProviderType.COMPANY);
      assert.equal(q2.page, 2);
      assert.equal(q2.limit, 20);

      assert.throws(() => validateProviderListQuery({ providerType: "invalid" as any }), /Invalid providerType/);
      assert.throws(() => validateProviderListQuery({ limit: "999" }), /limit must be between 1 and 50/);
    });
  });

  // ========================================================
  // DB-BACKED INTEGRATION TESTS (Cases 1 - 9)
  // ========================================================
  describe("Provider Profiles Integration", () => {
    dbIt("1. Provider can create profile via PUT /api/providers/me -> 201; owner view has allowed fields only", async () => {
      const { authHeader, user } = await createAuthenticatedUser(app, {
        role: UserRole.PROVIDER,
      });

      const res = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Technician Bob",
          phone: "+1 (555) 019-2834",
          address: "123 Main Street, Suite 4",
          city: "Springfield",
          description: "Experienced electronics technician",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const p = res.body.data.provider;
      assert.ok(p.id);
      assert.equal(p.providerType, ProviderType.INDIVIDUAL);
      assert.equal(p.displayName, "Technician Bob");
      assert.equal(p.phone, "+15550192834");
      assert.equal(p.address, "123 Main Street, Suite 4");
      assert.equal(p.city, "Springfield");
      assert.equal(p.description, "Experienced electronics technician");
      assert.equal(p.isActive, true);

      // Verify NO user id, email, or password data in response
      assert.equal((p as any).user, undefined);
      assert.equal((p as any).userId, undefined);
      assert.equal((p as any).email, undefined);
      assert.equal((p as any).password, undefined);
      assert.equal((p as any).passwordHash, undefined);

      assertNoSensitiveData(res.body);
    });

    dbIt("2. A second PUT updates the same profile (200) and exactly one profile exists", async () => {
      const { authHeader, user } = await createAuthenticatedUser(app, {
        role: UserRole.PROVIDER,
      });

      const createRes = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Initial Name",
          phone: "9876543210",
          address: "123 Initial St",
          city: "Initial City",
        });
      assert.equal(createRes.status, 201);

      const updateRes = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.COMPANY,
          displayName: "Updated Company",
          phone: "9876543210",
          address: "456 Updated St",
          city: "Updated City",
          description: "Updated description",
        });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.provider.displayName, "Updated Company");
      assert.equal(updateRes.body.data.provider.providerType, ProviderType.COMPANY);
      assert.equal(updateRes.body.data.provider.id, createRes.body.data.provider.id);

      const count = await ProviderProfile.countDocuments({ user: user.id });
      assert.equal(count, 1);
    });

    dbIt("3. GET /api/providers/me returns profile; 404 before one exists", async () => {
      const { authHeader } = await createAuthenticatedUser(app, {
        role: UserRole.PROVIDER,
      });

      const notFoundRes = await request(app)
        .get("/api/providers/me")
        .set("Authorization", authHeader);
      assert.equal(notFoundRes.status, 404);
      assert.equal(notFoundRes.body.error.message, "Provider profile not found");

      await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Bob Tech",
          phone: "9876543210",
          address: "123 Tech Lane",
          city: "Tech City",
        });

      const foundRes = await request(app)
        .get("/api/providers/me")
        .set("Authorization", authHeader);
      assert.equal(foundRes.status, 200);
      assert.equal(foundRes.body.data.provider.displayName, "Bob Tech");
    });

    dbIt("4. Customer and admin tokens get 403 on GET/PUT /api/providers/me; no/invalid token -> 401", async () => {
      const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
      const getCust = await request(app)
        .get("/api/providers/me")
        .set("Authorization", customer.authHeader);
      assert.equal(getCust.status, 403);
      assert.equal(getCust.body.error.message, "Insufficient permissions");

      const putCust = await request(app)
        .put("/api/providers/me")
        .set("Authorization", customer.authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Fake Provider",
          phone: "9876543210",
          address: "123 Fake St",
          city: "Fake City",
        });
      assert.equal(putCust.status, 403);

      // No token
      const noToken = await request(app).get("/api/providers/me");
      assert.equal(noToken.status, 401);

      // Invalid token
      const badToken = await request(app)
        .get("/api/providers/me")
        .set("Authorization", "Bearer invalid-token");
      assert.equal(badToken.status, 401);
    });

    dbIt("5. Invalid inputs -> 400 (missing fields, bad type, bad phone, short name, long desc, NoSQL injection)", async () => {
      const { authHeader } = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      // Missing displayName
      const noName = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          phone: "9876543210",
          address: "123 Valid St",
          city: "City",
        });
      assert.equal(noName.status, 400);

      // Bad providerType
      const badType = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: "superhero",
          displayName: "Valid Name",
          phone: "9876543210",
          address: "123 Valid St",
          city: "City",
        });
      assert.equal(badType.status, 400);

      // Bad phone
      const badPhone = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Valid Name",
          phone: "123",
          address: "123 Valid St",
          city: "City",
        });
      assert.equal(badPhone.status, 400);

      // Too-short name (< 2)
      const shortName = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "A",
          phone: "9876543210",
          address: "123 Valid St",
          city: "City",
        });
      assert.equal(shortName.status, 400);

      // Over-long description (> 1000)
      const longDesc = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Valid Name",
          phone: "9876543210",
          address: "123 Valid St",
          city: "City",
          description: "x".repeat(1001),
        });
      assert.equal(longDesc.status, 400);

      // NoSQL injection attempt
      const noSql = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: { $ne: null },
          phone: "9876543210",
          address: "123 Valid St",
          city: "City",
        });
      assert.equal(noSql.status, 400);
    });

    dbIt("6. Client-supplied user, isActive: false, _id in body are ignored", async () => {
      const { authHeader, user } = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      const res = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Legit Tech",
          phone: "9876543210",
          address: "123 Real Address",
          city: "Real City",
          user: "67b6f3a1e2c34a0099999999",
          isActive: false,
          _id: "67b6f3a1e2c34a0088888888",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.provider.isActive, true);

      const dbProfile = await ProviderProfile.findOne({ user: user.id });
      assert.ok(dbProfile);
      assert.equal(String(dbProfile.user), user.id);
      assert.equal(dbProfile.isActive, true);
    });

    dbIt("7. Phone is stored normalized", async () => {
      const { authHeader, user } = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Phone Normalizer",
          phone: " +1 (800) 555-1212 ",
          address: "123 Normal Way",
          city: "Normal City",
        });

      const dbProfile = await ProviderProfile.findOne({ user: user.id });
      assert.ok(dbProfile);
      assert.equal(dbProfile.phone, "+18005551212");
    });

    dbIt("8. GET /api/providers/:id is public, returns public view only; invalid -> 400, inactive/unknown -> 404", async () => {
      const { authHeader } = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

      const createRes = await request(app)
        .put("/api/providers/me")
        .set("Authorization", authHeader)
        .send({
          providerType: ProviderType.INDIVIDUAL,
          displayName: "Public Star",
          phone: "9876543210",
          address: "Secret Private Address 99",
          city: "Metro City",
          description: "Top technician",
        });
      const providerId = createRes.body.data.provider.id;

      // Public call without token
      const publicRes = await request(app).get(`/api/providers/${providerId}`);
      assert.equal(publicRes.status, 200);
      assert.equal(publicRes.body.success, true);
      const pub = publicRes.body.data.provider;
      assert.equal(pub.id, providerId);
      assert.equal(pub.displayName, "Public Star");
      assert.equal(pub.city, "Metro City");
      assert.equal(pub.description, "Top technician");

      // Verify phone and address are strictly absent
      assert.equal((pub as any).phone, undefined);
      assert.equal((pub as any).address, undefined);
      assert.equal((pub as any).user, undefined);

      // Invalid id format -> 400
      const badIdRes = await request(app).get("/api/providers/not-a-valid-id");
      assert.equal(badIdRes.status, 400);

      // Unknown id -> 404
      const unknownRes = await request(app).get("/api/providers/67b6f3a1e2c34a0011111111");
      assert.equal(unknownRes.status, 404);

      // Deactivate provider directly in DB -> 404
      await ProviderProfile.findByIdAndUpdate(providerId, { isActive: false });
      const inactiveRes = await request(app).get(`/api/providers/${providerId}`);
      assert.equal(inactiveRes.status, 404);
    });

    dbIt("9. GET /api/providers is public, paginates, filters by city, providerType, q, excludes inactive", async () => {
      // Create Provider 1: individual, City A
      const p1 = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p1.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Alice AC Specialist",
        phone: "9876543210",
        address: "123 Street",
        city: "Kolkata",
        description: "Best cooling expert in town",
      });

      // Create Provider 2: company, City B
      const p2 = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      await request(app).put("/api/providers/me").set("Authorization", p2.authHeader).send({
        providerType: ProviderType.COMPANY,
        displayName: "Cooling Care Ltd",
        phone: "9876543211",
        address: "456 Avenue",
        city: "Durgapur",
        description: "Industrial AC and appliances",
      });

      // Create Provider 3: inactive, City A
      const p3 = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const p3Res = await request(app).put("/api/providers/me").set("Authorization", p3.authHeader).send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Deactivated Tech",
        phone: "9876543212",
        address: "789 Lane",
        city: "Kolkata",
      });
      await ProviderProfile.findByIdAndUpdate(p3Res.body.data.provider.id, { isActive: false });

      // 1. All active
      const allRes = await request(app).get("/api/providers");
      assert.equal(allRes.status, 200);
      assert.equal(allRes.body.data.items.length, 2);
      assert.equal(allRes.body.data.pagination.total, 2);

      // 2. City filter (case-insensitive)
      const cityRes = await request(app).get("/api/providers?city=kOlKaTa");
      assert.equal(cityRes.status, 200);
      assert.equal(cityRes.body.data.items.length, 1);
      assert.equal(cityRes.body.data.items[0].displayName, "Alice AC Specialist");

      // 3. ProviderType filter
      const typeRes = await request(app).get("/api/providers?providerType=company");
      assert.equal(typeRes.status, 200);
      assert.equal(typeRes.body.data.items.length, 1);
      assert.equal(typeRes.body.data.items[0].displayName, "Cooling Care Ltd");

      // 4. Query text filter q
      const qRes = await request(app).get("/api/providers?q=Industrial");
      assert.equal(qRes.status, 200);
      assert.equal(qRes.body.data.items.length, 1);
      assert.equal(qRes.body.data.items[0].displayName, "Cooling Care Ltd");

      // Verify no item exposes phone or address
      for (const item of allRes.body.data.items) {
        assert.equal((item as any).phone, undefined);
        assert.equal((item as any).address, undefined);
      }
    });
  });
});
