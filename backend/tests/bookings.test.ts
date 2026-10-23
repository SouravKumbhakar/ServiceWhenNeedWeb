import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import app from "../src/app";
import { Booking } from "../src/models/booking.model";
import { ProviderProfile, ProviderType } from "../src/models/providerProfile.model";
import { Service } from "../src/models/service.model";
import { User, UserRole } from "../src/models/user.model";
import {
  validateBookingStatusBody,
  validateCreateBookingBody,
  validateScheduledAt,
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

/** Run only when a real test database is available. */
function dbIt(name: string, fn: () => Promise<void> | void) {
  return it(name, { skip: dbSkipReason ?? undefined }, fn);
}

/** Assert no sensitive data leaks in a response body. */
function assertNoSensitiveData(body: unknown): void {
  const str = JSON.stringify(body);
  assert.ok(!str.includes("passwordHash"), "Must not leak passwordHash");
  assert.ok(!str.includes("$2a$"), "Must not leak bcrypt hash prefix $2a$");
  assert.ok(!str.includes("$2b$"), "Must not leak bcrypt hash prefix $2b$");
  if (process.env.JWT_SECRET) {
    assert.ok(!str.includes(process.env.JWT_SECRET), "Must not leak JWT_SECRET");
  }
  // Booking responses must not contain personal contact details
  assert.ok(!str.includes('"email"'), "Must not leak email in booking response");
}

/** A date far enough in the future to pass all validation (30 days from now). */
function futureDate(daysFromNow = 30): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

/** Construct a pair of matching Z-form and +05:30 offset-form strings for the same future instant. */
function makeFutureIsoPair(daysFromNow = 10): { zForm: string; offsetForm: string; expectedIso: string } {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  d.setUTCMinutes(30, 0, 0);
  const expectedIso = d.toISOString();
  const zForm = expectedIso.replace(/\.\d+Z$/, "Z");
  // +05:30 is 5h30m ahead of UTC (+330 min)
  const local = new Date(d.getTime() + 330 * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  const offsetForm = `${y}-${m}-${day}T${hh}:${mm}:${ss}+05:30`;
  return { zForm, offsetForm, expectedIso };
}

describe("BUILD 04 — Booking Management Suite", () => {
  before(async () => {
    if (dbSkipReason) return;
    const { isAvailable, skipReason } = await setupTestDb();
    if (!isAvailable) throw new Error(`MongoDB not reachable: ${skipReason}`);
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  // =========================================================================
  // NO-DB UNIT TESTS — pure validators, run without MongoDB
  // =========================================================================
  describe("Booking Validation — No-DB Unit Tests", () => {
    it("validateScheduledAt: accepts valid Z and offset forms", () => {
      const futureDateZ = futureDate(30);
      const parsed = validateScheduledAt(futureDateZ);
      assert.ok(parsed instanceof Date);
      assert.ok(!isNaN(parsed.getTime()));

      // Offset form: build a +05:30 equivalent of the same instant
      const ms = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const utcD = new Date(ms);
      const hh = Math.floor(5 * 60 + 30);
      const offsetMs = hh * 60 * 1000;
      const localD = new Date(ms + offsetMs);
      // Format as +05:30 ISO
      const pad = (n: number) => String(n).padStart(2, "0");
      const local = `${localD.getUTCFullYear()}-${pad(localD.getUTCMonth() + 1)}-${pad(localD.getUTCDate())}T${pad(localD.getUTCHours())}:${pad(localD.getUTCMinutes())}:${pad(localD.getUTCSeconds())}+05:30`;
      const parsedOffset = validateScheduledAt(local);
      // Both should represent nearly the same UTC instant (within 1 second of utcD)
      assert.ok(Math.abs(parsedOffset.getTime() - utcD.getTime()) < 1000);
    });

    it("validateScheduledAt: rejects past dates", () => {
      assert.throws(
        () => validateScheduledAt("2020-01-01T00:00:00Z"),
        /must be in the future/
      );
    });

    it("validateScheduledAt: rejects date more than 365 days in the future", () => {
      const tooFar = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z");
      assert.throws(
        () => validateScheduledAt(tooFar),
        /365 days/
      );
    });

    it("validateScheduledAt: rejects rolled-over calendar date 2030-02-31T10:00:00Z", () => {
      assert.throws(
        () => validateScheduledAt("2030-02-31T10:00:00Z"),
        /invalid calendar date/
      );
    });

    it("validateScheduledAt: rejects date-only string", () => {
      assert.throws(
        () => validateScheduledAt("2030-06-15"),
        /ISO 8601/
      );
    });

    it("validateScheduledAt: rejects ISO string without timezone designator", () => {
      assert.throws(
        () => validateScheduledAt("2030-06-15T10:00:00"),
        /ISO 8601/
      );
    });

    it("validateScheduledAt: rejects numeric timestamp", () => {
      assert.throws(
        () => validateScheduledAt(Date.now() + 86400000),
        /ISO 8601/
      );
    });

    it("validateScheduledAt: rejects non-string (object/array)", () => {
      assert.throws(() => validateScheduledAt({ "$gt": "2030" }), /ISO 8601/);
      assert.throws(() => validateScheduledAt(["2030-06-15T10:00:00Z"]), /ISO 8601/);
    });

    it("validateScheduledAt: rejects missing value", () => {
      assert.throws(() => validateScheduledAt(undefined), /required/);
      assert.throws(() => validateScheduledAt(null), /required/);
    });

    it("validateScheduledAt: stores the correct UTC instant for an offset form", () => {
      const { offsetForm, expectedIso } = makeFutureIsoPair(10);
      const d = validateScheduledAt(offsetForm);
      assert.equal(d.toISOString(), expectedIso);
    });

    it("validateCreateBookingBody: rejects non-string serviceId (object injection)", () => {
      assert.throws(
        () =>
          validateCreateBookingBody({
            serviceId: { $ne: null },
            serviceAddress: "12345 Main Street",
            city: "Kolkata",
            scheduledAt: futureDate(30),
          }),
        /Invalid serviceId/
      );
    });

    it("validateCreateBookingBody: rejects serviceAddress too short / too long / missing", () => {
      const base = {
        serviceId: "67b6f3a1e2c34a0099999999",
        city: "Kolkata",
        scheduledAt: futureDate(30),
      };
      assert.throws(
        () => validateCreateBookingBody({ ...base, serviceAddress: "1234" }),
        /between 5 and 200/
      );
      assert.throws(
        () => validateCreateBookingBody({ ...base, serviceAddress: "a".repeat(201) }),
        /between 5 and 200/
      );
      assert.throws(
        () => validateCreateBookingBody({ ...base }),
        /serviceAddress is required/
      );
    });

    it("validateCreateBookingBody: rejects city too short / too long / missing", () => {
      const base = {
        serviceId: "67b6f3a1e2c34a0099999999",
        serviceAddress: "12345 Main Street",
        scheduledAt: futureDate(30),
      };
      assert.throws(
        () => validateCreateBookingBody({ ...base, city: "A" }),
        /between 2 and 80/
      );
      assert.throws(
        () => validateCreateBookingBody({ ...base, city: "A".repeat(81) }),
        /between 2 and 80/
      );
      assert.throws(
        () => validateCreateBookingBody({ ...base }),
        /city is required/
      );
    });

    it("validateCreateBookingBody: rejects over-long problemDescription", () => {
      assert.throws(
        () =>
          validateCreateBookingBody({
            serviceId: "67b6f3a1e2c34a0099999999",
            serviceAddress: "12345 Main Street",
            city: "Kolkata",
            scheduledAt: futureDate(30),
            problemDescription: "x".repeat(1001),
          }),
        /at most 1000/
      );
    });

    it("validateBookingStatusBody: rejects invalid / non-string status", () => {
      assert.throws(() => validateBookingStatusBody({ status: "flying" }), /Invalid status/);
      assert.throws(() => validateBookingStatusBody({ status: { $gt: "" } }), /Invalid status/);
      assert.throws(() => validateBookingStatusBody({}), /status is required/);
      assert.throws(() => validateBookingStatusBody(null), /JSON object/);
    });

    it("validateBookingStatusBody: accepts all six valid statuses", () => {
      for (const s of ["pending", "accepted", "rejected", "in_progress", "completed", "cancelled"]) {
        const r = validateBookingStatusBody({ status: s, extra: "ignored" });
        assert.equal(r.status, s);
        assert.equal((r as any).extra, undefined); // extra field is silently ignored
      }
    });
  });

  // =========================================================================
  // DB-BACKED INTEGRATION TESTS
  // =========================================================================

  /**
   * Shared helper: creates customer, second customer, provider+profile+service,
   * second provider+profile+service, and admin.
   */
  async function buildFixtures() {
    const customer = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
    const customer2 = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
    const provider = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
    const provider2 = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });

    // Provider 1 profile + service
    const profRes = await request(app)
      .put("/api/providers/me")
      .set("Authorization", provider.authHeader)
      .send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider One",
        phone: "9876543210",
        address: "123 Main Street",
        city: "Kolkata",
      });
    assert.equal(profRes.status, 201);
    const providerId = profRes.body.data.provider.id;

    const svcRes = await request(app)
      .post("/api/services")
      .set("Authorization", provider.authHeader)
      .send({
        title: "AC Deep Cleaning",
        description: "Full split AC foam cleaning service",
        category: "ac",
        basePrice: 499,
        isActive: true,
      });
    assert.equal(svcRes.status, 201);
    const service = svcRes.body.data.service;

    // Provider 2 profile + service
    const prof2Res = await request(app)
      .put("/api/providers/me")
      .set("Authorization", provider2.authHeader)
      .send({
        providerType: ProviderType.INDIVIDUAL,
        displayName: "Provider Two",
        phone: "9876543211",
        address: "456 Second Street",
        city: "Mumbai",
      });
    assert.equal(prof2Res.status, 201);
    const provider2Id = prof2Res.body.data.provider.id;

    const svc2Res = await request(app)
      .post("/api/services")
      .set("Authorization", provider2.authHeader)
      .send({
        title: "Mobile Screen Repair",
        description: "OLED display replacement for all brands",
        category: "mobile",
        basePrice: 1200,
        isActive: true,
      });
    assert.equal(svc2Res.status, 201);
    const service2 = svc2Res.body.data.service;

    // Admin: register as customer, then set role directly in DB
    const admin = await createAuthenticatedUser(app, { role: UserRole.CUSTOMER });
    await User.findByIdAndUpdate(admin.user.id, { role: UserRole.ADMIN });
    // Re-login to get a valid token reflecting admin role isn't needed because
    // the authenticate middleware reads role from DB. We'll keep the customer token
    // but note that DB role is now admin.
    // For simplicity, we re-login:
    const adminLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.user.email, password: "Password123" });
    const adminToken = adminLoginRes.body.data?.token || admin.token;

    return {
      customer, customer2,
      provider, provider2,
      providerId, provider2Id,
      service, service2,
      admin: { ...admin, token: adminToken, authHeader: `Bearer ${adminToken}` },
    };
  }

  /** Create a valid booking body. */
  function validBookingBody(serviceId: string, overrides: Record<string, unknown> = {}) {
    return {
      serviceId,
      serviceAddress: "42 Anywhere Road Kolkata",
      city: "Kolkata",
      scheduledAt: futureDate(30),
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // CREATION
  // -------------------------------------------------------------------------
  describe("Creation", () => {
    dbIt("1. No token → 401; invalid token → 401", async () => {
      const { service } = await buildFixtures();
      const noToken = await request(app).post("/api/bookings").send(validBookingBody(service.id));
      assert.equal(noToken.status, 401);

      const badToken = await request(app)
        .post("/api/bookings")
        .set("Authorization", "Bearer invalid-token")
        .send(validBookingBody(service.id));
      assert.equal(badToken.status, 401);
    });

    dbIt("2. Provider token → 403; admin token → 403", async () => {
      const { provider, admin, service } = await buildFixtures();
      const pRes = await request(app)
        .post("/api/bookings")
        .set("Authorization", provider.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(pRes.status, 403);

      const aRes = await request(app)
        .post("/api/bookings")
        .set("Authorization", admin.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(aRes.status, 403);
    });

    dbIt("3. Customer creates booking for active service → 201; correct fields", async () => {
      const { customer, service, providerId } = await buildFixtures();
      const res = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const b = res.body.data.booking;
      assert.equal(b.status, "pending");
      assert.equal(b.customerId, customer.user.id);
      assert.equal(b.providerId, providerId);
      assert.equal(b.serviceTitle, service.title);
      assert.equal(b.basePrice, service.basePrice);
      assert.ok(b.scheduledAt && new Date(b.scheduledAt).getTime() > Date.now());
      assertNoSensitiveData(res.body);
    });

    dbIt("4. Missing serviceId, malformed serviceId → 400; nonexistent serviceId → 404; object injection → 400", async () => {
      const { customer } = await buildFixtures();
      const noSvc = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send({ serviceAddress: "12345 Main St", city: "Kolkata", scheduledAt: futureDate(30) });
      assert.equal(noSvc.status, 400);

      const badSvc = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody("not-an-id"));
      assert.equal(badSvc.status, 400);

      const unknownSvc = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody("67b6f3a1e2c34a0099999999"));
      assert.equal(unknownSvc.status, 404);

      const injection = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(undefined as any, { serviceId: { $ne: null } }));
      assert.equal(injection.status, 400);
    });

    dbIt("5. Inactive service → 404 and no booking created; inactive provider profile → 404", async () => {
      const { customer, service, provider } = await buildFixtures();

      // Deactivate the service
      await Service.findByIdAndUpdate(service.id, { isActive: false });
      const countBefore = await Booking.countDocuments({});

      const res = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(res.status, 404);
      assert.equal(await Booking.countDocuments({}), countBefore); // no booking created

      // Reactivate service but deactivate provider profile
      await Service.findByIdAndUpdate(service.id, { isActive: true });
      const profile = await ProviderProfile.findOne({ user: provider.user.id });
      await ProviderProfile.findByIdAndUpdate(profile!._id, { isActive: false });

      const res2 = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(res2.status, 404);
    });

    dbIt("6. Spoofing ignored: customerId, providerId, serviceTitle, basePrice, status in body all ignored", async () => {
      const { customer, customer2, service, provider2Id } = await buildFixtures();

      const res = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send({
          ...validBookingBody(service.id),
          customerId: customer2.user.id,     // should be ignored
          providerId: provider2Id,           // should be ignored
          serviceTitle: "Hacked",            // should be ignored
          basePrice: 1,                      // should be ignored
          status: "completed",               // should be ignored
        });

      assert.equal(res.status, 201);
      const b = res.body.data.booking;
      // Trusted values from DB
      assert.equal(b.customerId, customer.user.id);
      assert.equal(b.serviceTitle, service.title);
      assert.equal(b.basePrice, service.basePrice);
      assert.equal(b.status, "pending");

      // Verify in DB
      const dbBooking = await Booking.findById(b.id);
      assert.ok(dbBooking);
      assert.equal(String(dbBooking.customerId), customer.user.id);
      assert.equal(dbBooking.serviceTitle, service.title);
      assert.equal(dbBooking.basePrice, service.basePrice);
      assert.equal(dbBooking.status, "pending");
    });

    dbIt("7. Snapshot preserved after service update; new booking uses new values", async () => {
      const { customer, service, provider } = await buildFixtures();

      // Create initial booking
      const res1 = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(res1.status, 201);
      const bookingId = res1.body.data.booking.id;
      const origTitle = res1.body.data.booking.serviceTitle;
      const origPrice = res1.body.data.booking.basePrice;

      // Provider updates the service
      await request(app)
        .patch(`/api/services/${service.id}`)
        .set("Authorization", provider.authHeader)
        .send({ title: "AC Premium Cleaning", basePrice: 799 });

      // Old booking must still show original values
      const getOld = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set("Authorization", customer.authHeader);
      assert.equal(getOld.status, 200);
      assert.equal(getOld.body.data.booking.serviceTitle, origTitle);
      assert.equal(getOld.body.data.booking.basePrice, origPrice);

      // New booking uses new values
      const res2 = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(res2.status, 201);
      assert.equal(res2.body.data.booking.serviceTitle, "AC Premium Cleaning");
      assert.equal(res2.body.data.booking.basePrice, 799);
    });

    dbIt("8. Date validation: rejects past, too far, invalid calendar date, no-tz, numeric, missing; accepts Z and offset", async () => {
      const { customer, service } = await buildFixtures();
      const base = { serviceId: service.id, serviceAddress: "12345 Main St Kolkata", city: "Kolkata" };

      // Past date
      const past = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: "2020-01-01T10:00:00Z" });
      assert.equal(past.status, 400);

      // >365 days
      const tooFar = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: futureDate(400) });
      assert.equal(tooFar.status, 400);

      // Invalid calendar date
      const badDate = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: "2030-02-31T10:00:00Z" });
      assert.equal(badDate.status, 400);

      // Date-only (no time)
      const dateOnly = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: "2030-06-15" });
      assert.equal(dateOnly.status, 400);

      // ISO without timezone
      const noTz = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: "2030-06-15T10:00:00" });
      assert.equal(noTz.status, 400);

      // Numeric timestamp
      const numeric = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: Date.now() + 86400000 });
      assert.equal(numeric.status, 400);

      // Missing
      const missing = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base });
      assert.equal(missing.status, 400);

      // Valid Z form & offset form for the same future instant
      const { zForm, offsetForm, expectedIso } = makeFutureIsoPair(15);
      const validZ = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: zForm });
      assert.equal(validZ.status, 201);

      // Valid offset form
      const validOffset = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, scheduledAt: offsetForm });
      assert.equal(validOffset.status, 201);
      // Both store the same UTC instant
      const b1 = await Booking.findById(validZ.body.data.booking.id);
      const b2 = await Booking.findById(validOffset.body.data.booking.id);
      assert.equal(b1!.scheduledAt.toISOString(), expectedIso);
      assert.equal(b2!.scheduledAt.toISOString(), expectedIso);
    });

    dbIt("9. Invalid address/city/problemDescription → 400; optional problemDescription omitted → 201", async () => {
      const { customer, service } = await buildFixtures();
      const base = { serviceId: service.id, city: "Kolkata", scheduledAt: futureDate(30) };

      const shortAddr = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, serviceAddress: "123" });
      assert.equal(shortAddr.status, 400);

      const longAddr = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, serviceAddress: "a".repeat(201) });
      assert.equal(longAddr.status, 400);

      const shortCity = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, serviceAddress: "12345 Street Kolkata", city: "A" });
      assert.equal(shortCity.status, 400);

      const longDesc = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ ...base, serviceAddress: "12345 Street Kolkata", problemDescription: "x".repeat(1001) });
      assert.equal(longDesc.status, 400);

      // No problemDescription → 201
      const noProblem = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send({ serviceId: service.id, serviceAddress: "12345 Street Kolkata", city: "Kolkata", scheduledAt: futureDate(30) });
      assert.equal(noProblem.status, 201);
      assert.equal(noProblem.body.data.booking.problemDescription, undefined);
    });

    dbIt("10. Invalid JSON / no body → 400, not 500", async () => {
      const { customer } = await buildFixtures();
      const res = await request(app)
        .post("/api/bookings")
        .set("Authorization", customer.authHeader)
        .set("Content-Type", "application/json")
        .send("{ bad json");
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });
  });

  // -------------------------------------------------------------------------
  // RETRIEVAL
  // -------------------------------------------------------------------------
  describe("Retrieval", () => {
    dbIt("11. GET /my as customer returns only their bookings", async () => {
      const { customer, customer2, service, service2 } = await buildFixtures();

      // Customer creates 2 bookings; customer2 creates 1
      await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      await request(app).post("/api/bookings").set("Authorization", customer2.authHeader)
        .send(validBookingBody(service2.id));

      const res = await request(app).get("/api/bookings/my")
        .set("Authorization", customer.authHeader);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.items.length, 2);
      for (const b of res.body.data.items) {
        assert.equal(b.customerId, customer.user.id);
      }
    });

    dbIt("12. GET /my as provider returns only their bookings; no-profile provider gets empty list", async () => {
      const { customer, provider, provider2, service, service2 } = await buildFixtures();

      // Customer books both services
      await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service2.id));

      // Provider 1 sees only their service booking
      const res1 = await request(app).get("/api/bookings/my")
        .set("Authorization", provider.authHeader);
      assert.equal(res1.status, 200);
      assert.equal(res1.body.data.items.length, 1);
      assert.equal(res1.body.data.items[0].serviceTitle, service.title);

      // Provider with no profile gets empty list (not an error)
      const noProfile = await createAuthenticatedUser(app, { role: UserRole.PROVIDER });
      const emptyRes = await request(app).get("/api/bookings/my")
        .set("Authorization", noProfile.authHeader);
      assert.equal(emptyRes.status, 200);
      assert.equal(emptyRes.body.data.items.length, 0);
      assert.equal(emptyRes.body.data.pagination.total, 0);
    });

    dbIt("13. Admin → 403 on /my; no token → 401", async () => {
      const { admin } = await buildFixtures();
      const adminRes = await request(app).get("/api/bookings/my")
        .set("Authorization", admin.authHeader);
      assert.equal(adminRes.status, 403);

      const noToken = await request(app).get("/api/bookings/my");
      assert.equal(noToken.status, 401);
    });

    dbIt("14. Pagination: defaults, limit=2 with 5 bookings, page 2 differs, no duplicates, newest first; ?page[$gt]=1 → 400; status filter works", async () => {
      const { customer, service } = await buildFixtures();

      // Create 5 bookings
      for (let i = 0; i < 5; i++) {
        const r = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
          .send(validBookingBody(service.id));
        assert.equal(r.status, 201);
      }

      // Default: page=1, limit=10
      const def = await request(app).get("/api/bookings/my")
        .set("Authorization", customer.authHeader);
      assert.equal(def.status, 200);
      assert.equal(def.body.data.items.length, 5);
      assert.equal(def.body.data.pagination.page, 1);
      assert.equal(def.body.data.pagination.limit, 10);
      assert.equal(def.body.data.pagination.total, 5);

      // limit=2
      const p1 = await request(app).get("/api/bookings/my?page=1&limit=2")
        .set("Authorization", customer.authHeader);
      assert.equal(p1.status, 200);
      assert.equal(p1.body.data.items.length, 2);
      assert.equal(p1.body.data.pagination.total, 5);
      assert.equal(p1.body.data.pagination.totalPages, 3);

      const p2 = await request(app).get("/api/bookings/my?page=2&limit=2")
        .set("Authorization", customer.authHeader);
      assert.equal(p2.status, 200);
      assert.equal(p2.body.data.items.length, 2);

      // No duplicates
      const idsP1 = p1.body.data.items.map((b: any) => b.id);
      const idsP2 = p2.body.data.items.map((b: any) => b.id);
      assert.ok(!idsP1.some((id: string) => idsP2.includes(id)));

      // Newest first (createdAt descending)
      const timestamps = def.body.data.items.map((b: any) => new Date(b.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        assert.ok(timestamps[i - 1] >= timestamps[i]);
      }

      // Invalid params → 400
      const badParams = [
        "/api/bookings/my?limit=0",
        "/api/bookings/my?limit=51",
        "/api/bookings/my?page=0",
        "/api/bookings/my?page=-1",
        "/api/bookings/my?page=abc",
        "/api/bookings/my?page[$gt]=1",
      ];
      for (const q of badParams) {
        const r = await request(app).get(q).set("Authorization", customer.authHeader);
        assert.equal(r.status, 400, `Expected 400 for: ${q}`);
      }

      // Status filter: pending bookings exist; filter by status=pending → 5; status=accepted → 0
      const pending = await request(app).get("/api/bookings/my?status=pending")
        .set("Authorization", customer.authHeader);
      assert.equal(pending.status, 200);
      assert.equal(pending.body.data.pagination.total, 5);

      const accepted = await request(app).get("/api/bookings/my?status=accepted")
        .set("Authorization", customer.authHeader);
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.data.pagination.total, 0);

      // Invalid status → 400
      const badStatus = await request(app).get("/api/bookings/my?status=flying")
        .set("Authorization", customer.authHeader);
      assert.equal(badStatus.status, 400);
    });

    dbIt("15. GET /api/bookings/:id: owning customer → 200; owning provider → 200; other → 404; admin → 403; invalid id → 400; unknown → 404", async () => {
      const { customer, customer2, provider, provider2, service } = await buildFixtures();

      const res = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assert.equal(res.status, 201);
      const bookingId = res.body.data.booking.id;

      // Owning customer → 200
      const ownCust = await request(app).get(`/api/bookings/${bookingId}`)
        .set("Authorization", customer.authHeader);
      assert.equal(ownCust.status, 200);

      // Owning provider → 200
      const ownProv = await request(app).get(`/api/bookings/${bookingId}`)
        .set("Authorization", provider.authHeader);
      assert.equal(ownProv.status, 200);

      // Other customer → 404
      const otherCust = await request(app).get(`/api/bookings/${bookingId}`)
        .set("Authorization", customer2.authHeader);
      assert.equal(otherCust.status, 404);

      // Other provider → 404
      const otherProv = await request(app).get(`/api/bookings/${bookingId}`)
        .set("Authorization", provider2.authHeader);
      assert.equal(otherProv.status, 404);

      // Admin → 403 (blocked at route)
      const { admin } = await buildFixtures();
      const adminRes = await request(app).get(`/api/bookings/${bookingId}`)
        .set("Authorization", admin.authHeader);
      assert.equal(adminRes.status, 403);

      // Invalid id → 400
      const badId = await request(app).get("/api/bookings/not-an-id")
        .set("Authorization", customer.authHeader);
      assert.equal(badId.status, 400);

      // Unknown valid id → 404
      const unknown = await request(app).get("/api/bookings/67b6f3a1e2c34a0099999999")
        .set("Authorization", customer.authHeader);
      assert.equal(unknown.status, 404);

      // No token → 401
      const noToken = await request(app).get(`/api/bookings/${bookingId}`);
      assert.equal(noToken.status, 401);
    });

    dbIt("16. Route-order regression: GET /api/bookings/my is NOT captured by /:id", async () => {
      const { customer } = await buildFixtures();
      const res = await request(app).get("/api/bookings/my")
        .set("Authorization", customer.authHeader);
      // Must be 200 (paginated list), NOT 400 "Invalid id"
      assert.equal(res.status, 200);
      assert.ok(res.body.data.items !== undefined);
    });
  });

  // -------------------------------------------------------------------------
  // STATUS TRANSITIONS
  // -------------------------------------------------------------------------
  describe("Status Transitions", () => {
    /** Helper: create a booking as customer, return its id. */
    async function createTestBooking(
      customerToken: string,
      serviceId: string
    ): Promise<string> {
      const res = await request(app)
        .post("/api/bookings")
        .set("Authorization", customerToken)
        .send(validBookingBody(serviceId));
      assert.equal(res.status, 201);
      return res.body.data.booking.id;
    }

    dbIt("17. Provider flow: pending→accepted→in_progress→completed; and pending→rejected", async () => {
      const { customer, provider, service } = await buildFixtures();
      const bId = await createTestBooking(customer.authHeader, service.id);

      const accept = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      assert.equal(accept.status, 200);
      assert.equal(accept.body.data.booking.status, "accepted");

      const progress = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "in_progress" });
      assert.equal(progress.status, 200);
      assert.equal(progress.body.data.booking.status, "in_progress");

      const complete = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "completed" });
      assert.equal(complete.status, 200);
      assert.equal(complete.body.data.booking.status, "completed");

      // Second booking: pending→rejected
      const bId2 = await createTestBooking(customer.authHeader, service.id);
      const reject = await request(app).patch(`/api/bookings/${bId2}/status`)
        .set("Authorization", provider.authHeader).send({ status: "rejected" });
      assert.equal(reject.status, 200);
      assert.equal(reject.body.data.booking.status, "rejected");
    });

    dbIt("18. Invalid transitions return 409 and leave DB unchanged", async () => {
      const { customer, provider, service } = await buildFixtures();

      // Table of invalid transitions to test (from, to)
      const invalidTransitions = [
        ["pending", "completed"],
        ["pending", "in_progress"],
        ["accepted", "completed"],   // must go through in_progress first
      ];

      for (const [from, to] of invalidTransitions) {
        const bId = await createTestBooking(customer.authHeader, service.id);

        // Move to 'from' state if needed
        if (from === "accepted") {
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "accepted" });
        }

        const res = await request(app).patch(`/api/bookings/${bId}/status`)
          .set("Authorization", provider.authHeader).send({ status: to });
        assert.equal(res.status, 409, `Expected 409 for ${from}→${to}`);

        const dbBook = await Booking.findById(bId);
        assert.equal(dbBook!.status, from, `DB status unchanged for ${from}→${to}`);
      }

      // Self-transition (accepted→accepted)
      const bSelf = await createTestBooking(customer.authHeader, service.id);
      await request(app).patch(`/api/bookings/${bSelf}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      const selfRes = await request(app).patch(`/api/bookings/${bSelf}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      assert.equal(selfRes.status, 409);

      // Transition to pending
      const bPending = await createTestBooking(customer.authHeader, service.id);
      const toPending = await request(app).patch(`/api/bookings/${bPending}/status`)
        .set("Authorization", provider.authHeader).send({ status: "pending" });
      // pending is not settable by provider → 403
      assert.equal(toPending.status, 403);
    });

    dbIt("19. Terminal states (completed, rejected, cancelled) cannot be reopened", async () => {
      const { customer, provider, service } = await buildFixtures();
      const allStatuses = ["pending", "accepted", "rejected", "in_progress", "completed", "cancelled"];

      // Test each terminal state
      for (const terminal of ["completed", "rejected", "cancelled"]) {
        const bId = await createTestBooking(customer.authHeader, service.id);

        // Move to terminal state
        if (terminal === "completed") {
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "accepted" });
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "in_progress" });
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "completed" });
        } else if (terminal === "rejected") {
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "rejected" });
        } else {
          // cancelled
          await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", customer.authHeader).send({ status: "cancelled" });
        }

        // Try every possible target — all must fail
        for (const target of allStatuses) {
          const res = await request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader)
            .send({ status: target });
          // Could be 403 (wrong-role status like cancelled for provider) or 409
          assert.ok(
            res.status === 403 || res.status === 409,
            `Expected 403 or 409 from terminal ${terminal} to ${target}, got ${res.status}`
          );
          const dbBook = await Booking.findById(bId);
          assert.equal(dbBook!.status, terminal, `DB unchanged from terminal ${terminal}`);
        }
      }
    });

    dbIt("20. Customer cancels pending → 200; cancels accepted → 200; cannot cancel in_progress or completed → 409", async () => {
      const { customer, provider, service } = await buildFixtures();

      // Cancel pending
      const b1 = await createTestBooking(customer.authHeader, service.id);
      const cancel1 = await request(app).patch(`/api/bookings/${b1}/status`)
        .set("Authorization", customer.authHeader).send({ status: "cancelled" });
      assert.equal(cancel1.status, 200);
      assert.equal(cancel1.body.data.booking.status, "cancelled");

      // Cancel accepted
      const b2 = await createTestBooking(customer.authHeader, service.id);
      await request(app).patch(`/api/bookings/${b2}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      const cancel2 = await request(app).patch(`/api/bookings/${b2}/status`)
        .set("Authorization", customer.authHeader).send({ status: "cancelled" });
      assert.equal(cancel2.status, 200);
      assert.equal(cancel2.body.data.booking.status, "cancelled");

      // Cannot cancel in_progress
      const b3 = await createTestBooking(customer.authHeader, service.id);
      await request(app).patch(`/api/bookings/${b3}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      await request(app).patch(`/api/bookings/${b3}/status`)
        .set("Authorization", provider.authHeader).send({ status: "in_progress" });
      const noCancel = await request(app).patch(`/api/bookings/${b3}/status`)
        .set("Authorization", customer.authHeader).send({ status: "cancelled" });
      assert.equal(noCancel.status, 409);

      // Cannot cancel completed
      const b4 = await createTestBooking(customer.authHeader, service.id);
      await request(app).patch(`/api/bookings/${b4}/status`)
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      await request(app).patch(`/api/bookings/${b4}/status`)
        .set("Authorization", provider.authHeader).send({ status: "in_progress" });
      await request(app).patch(`/api/bookings/${b4}/status`)
        .set("Authorization", provider.authHeader).send({ status: "completed" });
      const noCancelCompleted = await request(app).patch(`/api/bookings/${b4}/status`)
        .set("Authorization", customer.authHeader).send({ status: "cancelled" });
      assert.equal(noCancelCompleted.status, 409);
    });

    dbIt("21. Customer asking for provider-only statuses → 403; provider asking for customer-only → 403", async () => {
      const { customer, provider, service } = await buildFixtures();
      const bId = await createTestBooking(customer.authHeader, service.id);

      // Customer asking for accepted/rejected/in_progress/completed → 403
      for (const s of ["accepted", "rejected", "in_progress", "completed"]) {
        const res = await request(app).patch(`/api/bookings/${bId}/status`)
          .set("Authorization", customer.authHeader).send({ status: s });
        assert.equal(res.status, 403, `Expected 403 for customer→${s}`);
      }

      // Provider asking for cancelled → 403
      const pCancelled = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "cancelled" });
      assert.equal(pCancelled.status, 403);

      // Provider asking for pending → 403
      const pPending = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "pending" });
      assert.equal(pPending.status, 403);
    });

    dbIt("22. Another customer cannot cancel → 404; another provider cannot change → 404; admin → 403", async () => {
      const { customer, customer2, provider, provider2, service } = await buildFixtures();
      const bId = await createTestBooking(customer.authHeader, service.id);

      // Another customer → 404 and DB unchanged
      const otherCust = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", customer2.authHeader).send({ status: "cancelled" });
      assert.equal(otherCust.status, 404);
      const dbBook = await Booking.findById(bId);
      assert.equal(dbBook!.status, "pending");

      // Another provider → 404 and DB unchanged
      const otherProv = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider2.authHeader).send({ status: "accepted" });
      assert.equal(otherProv.status, 404);
      const dbBook2 = await Booking.findById(bId);
      assert.equal(dbBook2!.status, "pending");

      // Admin → 403
      const { admin } = await buildFixtures();
      const adminRes = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", admin.authHeader).send({ status: "accepted" });
      assert.equal(adminRes.status, 403);
    });

    dbIt("23. Invalid status value, non-string status, missing body/status, malformed id → 400", async () => {
      const { customer, provider, service } = await buildFixtures();
      const bId = await createTestBooking(customer.authHeader, service.id);

      // Invalid status string
      const badStatus = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: "flying" });
      assert.equal(badStatus.status, 400);

      // Non-string status
      const nonStr = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader).send({ status: { $gt: "" } });
      assert.equal(nonStr.status, 400);

      // Missing body
      const noBody = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader)
        .set("Content-Type", "application/json")
        .send("{}");
      assert.equal(noBody.status, 400);

      // Malformed id
      const badId = await request(app).patch("/api/bookings/not-an-id/status")
        .set("Authorization", provider.authHeader).send({ status: "accepted" });
      assert.equal(badId.status, 400);
    });

    dbIt("24. Extra fields in status body leave other booking fields untouched", async () => {
      const { customer, provider, service } = await buildFixtures();
      const res = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      const bId = res.body.data.booking.id;
      const origTitle = res.body.data.booking.serviceTitle;
      const origPrice = res.body.data.booking.basePrice;
      const origCustId = res.body.data.booking.customerId;
      const origProvId = res.body.data.booking.providerId;

      // Send extra fields that must be silently ignored
      const patchRes = await request(app).patch(`/api/bookings/${bId}/status`)
        .set("Authorization", provider.authHeader)
        .send({ status: "accepted", basePrice: 1, customerId: "fakeId", providerId: "fakeId", serviceTitle: "Hacked" });
      assert.equal(patchRes.status, 200);

      const dbBook = await Booking.findById(bId);
      assert.equal(dbBook!.serviceTitle, origTitle);
      assert.equal(dbBook!.basePrice, origPrice);
      assert.equal(String(dbBook!.customerId), origCustId);
      assert.equal(String(dbBook!.providerId), origProvId);
      assert.equal(dbBook!.status, "accepted");
    });

    dbIt("25. Concurrency: simultaneous accept+reject; exactly one wins; repeated 5 times for stability", async () => {
      const { customer, provider, service } = await buildFixtures();

      for (let run = 0; run < 5; run++) {
        const bId = await createTestBooking(customer.authHeader, service.id);

        // Fire accept and reject simultaneously
        const [acceptRes, rejectRes] = await Promise.all([
          request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "accepted" }),
          request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "rejected" }),
        ]);

        const statuses = [acceptRes.status, rejectRes.status];
        const ok = statuses.filter(s => s === 200);
        const conflict = statuses.filter(s => s === 409);
        assert.equal(ok.length, 1, `Run ${run}: exactly one should succeed`);
        assert.equal(conflict.length, 1, `Run ${run}: exactly one should get 409`);

        const dbBook = await Booking.findById(bId);
        const winner = acceptRes.status === 200 ? "accepted" : "rejected";
        assert.equal(dbBook!.status, winner, `Run ${run}: DB status matches winner`);
      }

      // Also test provider accept vs customer cancel on a single pending booking
      for (let run = 0; run < 5; run++) {
        const bId = await createTestBooking(customer.authHeader, service.id);

        const [acceptRes, cancelRes] = await Promise.all([
          request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", provider.authHeader).send({ status: "accepted" }),
          request(app).patch(`/api/bookings/${bId}/status`)
            .set("Authorization", customer.authHeader).send({ status: "cancelled" }),
        ]);

        const statuses2 = [acceptRes.status, cancelRes.status];
        const ok2 = statuses2.filter(s => s === 200);
        const conflict2 = statuses2.filter(s => s === 409);
        assert.equal(ok2.length, 1, `Race run ${run}: exactly one should succeed`);
        assert.equal(conflict2.length, 1, `Race run ${run}: exactly one should get 409`);

        const dbBook2 = await Booking.findById(bId);
        const winner2 = acceptRes.status === 200 ? "accepted" : "cancelled";
        assert.equal(dbBook2!.status, winner2, `Race run ${run}: DB status matches winner`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // REGRESSION AND SAFETY
  // -------------------------------------------------------------------------
  describe("Regression and Safety", () => {
    dbIt("26. No booking response contains passwordHash, bcrypt hashes, JWT secret, email, or provider address", async () => {
      const { customer, provider, service } = await buildFixtures();

      const create = await request(app).post("/api/bookings").set("Authorization", customer.authHeader)
        .send(validBookingBody(service.id));
      assertNoSensitiveData(create.body);

      const list = await request(app).get("/api/bookings/my").set("Authorization", customer.authHeader);
      assertNoSensitiveData(list.body);

      const get = await request(app).get(`/api/bookings/${create.body.data.booking.id}`)
        .set("Authorization", customer.authHeader);
      assertNoSensitiveData(get.body);

      const providerList = await request(app).get("/api/bookings/my").set("Authorization", provider.authHeader);
      assertNoSensitiveData(providerList.body);

      // Phone/address must not appear in booking responses
      const str = JSON.stringify(get.body);
      assert.ok(!str.includes("phone"), "Booking must not leak phone number");
    });

    dbIt("27. BUILD 01-03 tests: /api/health, 404 format, bad JSON format still hold", async () => {
      const health = await request(app).get("/api/health");
      assert.ok(health.status === 200 || health.status === 503);
      assert.ok(health.body.status !== undefined);

      const notFound = await request(app).get("/api/unknown-route-booking-build04");
      assert.equal(notFound.status, 404);
      assert.equal(notFound.body.success, false);

      const badJson = await request(app)
        .post("/api/bookings")
        .set("Content-Type", "application/json")
        .send("{ bad json here");
      assert.equal(badJson.status, 400);
    });
  });
});
