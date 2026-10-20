import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app";
import { authorizeRoles } from "../src/middleware/auth.middleware";
import { User, UserRole } from "../src/models/user.model";
import {
  checkTestDbSafety,
  clearTestDb,
  getDbSkipReason,
  setupTestDb,
  teardownTestDb,
} from "./helpers/testDb";

// Check safety guards immediately on test load
checkTestDbSafety();
const dbSkipReason = getDbSkipReason();

// Helper to define DB-dependent tests with skip reason when DB is not configured
function dbIt(name: string, fn: () => Promise<void> | void) {
  return it(name, { skip: dbSkipReason ?? undefined }, fn);
}

// Cross-cutting check: assert no sensitive strings leak in responses
function assertNoSensitiveData(body: unknown): void {
  const str = JSON.stringify(body);
  assert.ok(!str.includes("passwordHash"), "Response body must not contain passwordHash");
  assert.ok(!str.includes("$2a$"), "Response body must not contain bcrypt hash prefix $2a$");
  assert.ok(!str.includes("$2b$"), "Response body must not contain bcrypt hash prefix $2b$");
  if (process.env.JWT_SECRET) {
    assert.ok(!str.includes(process.env.JWT_SECRET), "Response body must not contain JWT secret");
  }
}

describe("BUILD 02 — Authentication & User Management Suite", () => {
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

  // ==========================================
  // REGISTRATION TESTS (Cases 1 - 11)
  // ==========================================
  describe("Registration", () => {
    dbIt("1. Valid registration -> 201 with safe user and no passwords", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Alice Smith",
          email: "alice@example.com",
          password: "Password123",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data?.user);

      const user = res.body.data.user;
      assert.ok(user.id);
      assert.equal(user.name, "Alice Smith");
      assert.equal(user.email, "alice@example.com");
      assert.equal(user.role, UserRole.CUSTOMER);
      assert.equal(user.isActive, true);
      assert.ok(user.createdAt);
      assert.ok(user.updatedAt);
      assert.equal((user as any).passwordHash, undefined);
      assert.equal((user as any).password, undefined);

      assertNoSensitiveData(res.body);
    });

    dbIt("2. Email is normalized (trimmed and lowercased)", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Bob Jones",
          email: "  Test@Example.COM ",
          password: "Password123",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.email, "test@example.com");

      const savedUser = await User.findOne({ email: "test@example.com" });
      assert.ok(savedUser);
      assert.equal(savedUser.email, "test@example.com");
    });

    dbIt("3. Stored passwordHash is not plaintext and starts with $2", async () => {
      const plainPassword = "Password123";
      await request(app)
        .post("/api/auth/register")
        .send({
          name: "Charlie",
          email: "charlie@example.com",
          password: plainPassword,
        });

      const user = await User.findOne({ email: "charlie@example.com" }).select("+passwordHash");
      assert.ok(user);
      assert.notEqual(user.passwordHash, plainPassword);
      assert.ok(user.passwordHash.startsWith("$2"));
    });

    dbIt("4. role: 'provider' is accepted and stored", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Dave Provider",
          email: "dave@example.com",
          password: "Password123",
          role: "provider",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.role, "provider");

      const savedUser = await User.findOne({ email: "dave@example.com" });
      assert.ok(savedUser);
      assert.equal(savedUser.role, "provider");
    });

    dbIt("5. Missing name / email / password -> 400 each", async () => {
      const noName = await request(app)
        .post("/api/auth/register")
        .send({ email: "user@example.com", password: "Password123" });
      assert.equal(noName.status, 400);

      const noEmail = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", password: "Password123" });
      assert.equal(noEmail.status, 400);

      const noPass = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "user@example.com" });
      assert.equal(noPass.status, 400);
    });

    dbIt("6. Invalid email format, short password, no number, >72 bytes -> 400", async () => {
      // Invalid email
      const badEmail = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "invalid-email", password: "Password123" });
      assert.equal(badEmail.status, 400);

      // Short password (< 8)
      const shortPass = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "u1@example.com", password: "Pass1" });
      assert.equal(shortPass.status, 400);

      // No number
      const noNumPass = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "u2@example.com", password: "PasswordOnly" });
      assert.equal(noNumPass.status, 400);

      // > 72 bytes
      const longPass = "A1" + "a".repeat(75);
      const tooLongRes = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "u3@example.com", password: longPass });
      assert.equal(tooLongRes.status, 400);
    });

    dbIt("7. Non-string field types (NoSQL injection attempt) -> 400", async () => {
      const objEmail = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: { $ne: null }, password: "Password123" });
      assert.equal(objEmail.status, 400);

      const numPass = await request(app)
        .post("/api/auth/register")
        .send({ name: "User", email: "u@example.com", password: 12345678 });
      assert.equal(numPass.status, 400);
    });

    dbIt("8. Duplicate email (including case insensitive) -> 409", async () => {
      const first = await request(app)
        .post("/api/auth/register")
        .send({ name: "First", email: "dup@example.com", password: "Password123" });
      assert.equal(first.status, 201);

      const second = await request(app)
        .post("/api/auth/register")
        .send({ name: "Second", email: "DUP@example.com", password: "Password123" });
      assert.equal(second.status, 409);
      assert.equal(second.body.error.message, "Email is already registered");
    });

    dbIt("9. role: 'admin' -> 400, and no user created", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Admin Attempter",
          email: "hacker@example.com",
          password: "Password123",
          role: "admin",
        });

      assert.equal(res.status, 400);
      const user = await User.findOne({ email: "hacker@example.com" });
      assert.equal(user, null);
    });

    dbIt("10. Extra fields isActive: false and passwordHash: 'x' are ignored", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Clever User",
          email: "clever@example.com",
          password: "Password123",
          isActive: false,
          passwordHash: "malicious_hash",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.isActive, true);

      const dbUser = await User.findOne({ email: "clever@example.com" }).select("+passwordHash");
      assert.ok(dbUser);
      assert.equal(dbUser.isActive, true);
      assert.notEqual(dbUser.passwordHash, "malicious_hash");
    });

    dbIt("11. No body at all -> 400 (not 500)", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json");

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.statusCode, 400);
    });
  });

  // ==========================================
  // LOGIN TESTS (Cases 12 - 17)
  // ==========================================
  describe("Login", () => {
    dbIt("12. Valid login -> 200 with token and safe user (JWT decoded)", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Login User",
        email: "login@example.com",
        password: "Password123",
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "login@example.com",
          password: "Password123",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.tokenType, "Bearer");
      assert.ok(res.body.data.user);
      assert.equal((res.body.data.user as any).passwordHash, undefined);

      // Verify token decoded claims
      const decoded = jwt.decode(res.body.data.token) as jwt.JwtPayload;
      assert.ok(decoded);
      assert.equal(decoded.sub, res.body.data.user.id);
      assert.equal(decoded.role, UserRole.CUSTOMER);
      assert.equal(decoded.email, undefined);
      assert.equal((decoded as any).password, undefined);

      assertNoSensitiveData(res.body);
    });

    dbIt("13. Email lookup is case-insensitive on login", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Case Test",
        email: "case@example.com",
        password: "Password123",
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "  CASE@Example.COM  ",
          password: "Password123",
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.data.token);
    });

    dbIt("14. Wrong password -> 401 Invalid email or password", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Pass Test",
        email: "wrongpass@example.com",
        password: "Password123",
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "wrongpass@example.com",
          password: "WrongPassword999",
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid email or password");
    });

    dbIt("15. Unknown email -> 401 with IDENTICAL message and body as wrong-password", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Identical Test",
        email: "exists@example.com",
        password: "Password123",
      });

      const wrongPassRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "exists@example.com", password: "WrongPassword1" });

      const unknownEmailRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "unknown@example.com", password: "Password123" });

      assert.equal(wrongPassRes.status, 401);
      assert.equal(unknownEmailRes.status, 401);
      assert.deepEqual(wrongPassRes.body, unknownEmailRes.body);
    });

    dbIt("16. Missing fields & non-string types on login -> 400", async () => {
      const missingPass = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@example.com" });
      assert.equal(missingPass.status, 400);

      const noSqlInjection = await request(app)
        .post("/api/auth/login")
        .send({ email: { $ne: null }, password: "Password123" });
      assert.equal(noSqlInjection.status, 400);
    });

    dbIt("17. Inactive account with correct password -> 403 and no token", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Disabled User",
        email: "disabled@example.com",
        password: "Password123",
      });

      // Directly deactivate user in DB
      await User.updateOne({ email: "disabled@example.com" }, { isActive: false });

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "disabled@example.com", password: "Password123" });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.message, "Account is disabled");
      assert.equal(res.body.data, undefined);
    });
  });

  // ==========================================
  // AUTHENTICATED /me TESTS (Cases 18 - 28)
  // ==========================================
  describe("Authenticated /me", () => {
    dbIt("18. Valid token -> 200 with safe profile matching user", async () => {
      const reg = await request(app).post("/api/auth/register").send({
        name: "Me User",
        email: "me@example.com",
        password: "Password123",
      });
      const login = await request(app).post("/api/auth/login").send({
        email: "me@example.com",
        password: "Password123",
      });
      const token = login.body.data.token;

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.id, reg.body.data.user.id);
      assert.equal(res.body.data.user.email, "me@example.com");
      assert.equal((res.body.data.user as any).passwordHash, undefined);

      assertNoSensitiveData(res.body);
    });

    dbIt("19. No Authorization header -> 401", async () => {
      const res = await request(app).get("/api/auth/me");
      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Authentication required");
    });

    dbIt("20. Malformed Authorization headers -> 401", async () => {
      const basic = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Basic abc");
      assert.equal(basic.status, 401);

      const noToken = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer");
      assert.equal(noToken.status, 401);

      const tooManyParts = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer token extra");
      assert.equal(tooManyParts.status, 401);
    });

    dbIt("21. Garbage token -> 401 Invalid token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer not-a-valid-jwt-token");
      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid token");
    });

    dbIt("22. Token signed with different secret -> 401", async () => {
      const fakeToken = jwt.sign(
        { role: "customer" },
        "different-secret-that-is-at-least-32-chars-long",
        { subject: new mongoose.Types.ObjectId().toString(), algorithm: "HS256" }
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${fakeToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid token");
    });

    dbIt("23. Expired token -> 401 Token expired", async () => {
      const expiredToken = jwt.sign(
        { role: "customer" },
        process.env.JWT_SECRET!,
        {
          subject: new mongoose.Types.ObjectId().toString(),
          expiresIn: -10,
          algorithm: "HS256",
        }
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${expiredToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Token expired");
    });

    dbIt("24. Token with 'none' algorithm -> 401", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({ sub: new mongoose.Types.ObjectId().toString(), role: "customer" })
      ).toString("base64url");
      const noneToken = `${header}.${payload}.`;

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${noneToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid token");
    });

    dbIt("25. Valid token whose user was deactivated after login -> 401", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Deact User",
        email: "deact@example.com",
        password: "Password123",
      });
      const login = await request(app).post("/api/auth/login").send({
        email: "deact@example.com",
        password: "Password123",
      });
      const token = login.body.data.token;

      // Deactivate user in DB
      await User.updateOne({ email: "deact@example.com" }, { isActive: false });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid or inactive account");
    });

    dbIt("26. Valid token whose user was deleted -> 401", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Delete User",
        email: "delete@example.com",
        password: "Password123",
      });
      const login = await request(app).post("/api/auth/login").send({
        email: "delete@example.com",
        password: "Password123",
      });
      const token = login.body.data.token;

      // Delete user
      await User.deleteOne({ email: "delete@example.com" });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid or inactive account");
    });

    dbIt("27. Token with valid signature but non-ObjectId sub -> 401", async () => {
      const badSubToken = jwt.sign(
        { role: "customer" },
        process.env.JWT_SECRET!,
        { subject: "not-an-object-id", algorithm: "HS256" }
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${badSubToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, "Invalid token");
    });

    dbIt("28. User role changed in DB after token issued: req.user.role follows DB", async () => {
      await request(app).post("/api/auth/register").send({
        name: "Role Change User",
        email: "rolechange@example.com",
        password: "Password123",
      });
      const login = await request(app).post("/api/auth/login").send({
        email: "rolechange@example.com",
        password: "Password123",
      });
      const token = login.body.data.token;

      // Update role to provider directly in DB
      await User.updateOne({ email: "rolechange@example.com" }, { role: UserRole.PROVIDER });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.role, UserRole.PROVIDER);
    });
  });

  // ==========================================
  // CROSS-CUTTING TESTS (Cases 29 - 31)
  // ==========================================
  describe("Cross-cutting & Foundation Preservations", () => {
    dbIt("29. Sensitive data leakage prevention check across endpoints", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Leak Test", email: "leak@example.com", password: "Password123" });
      assertNoSensitiveData(res.body);

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "leak@example.com", password: "Password123" });
      assertNoSensitiveData(loginRes.body);

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${loginRes.body.data.token}`);
      assertNoSensitiveData(meRes.body);
    });

    it("30. Health endpoint returns valid JSON with status, 404 for unknown route, 400 for malformed JSON", async () => {
      const health = await request(app).get("/api/health");
      assert.ok(health.status === 200 || health.status === 503);
      assert.ok(health.body.status !== undefined);

      const notFoundRes = await request(app).get("/api/non-existent-route-xyz");
      assert.equal(notFoundRes.status, 404);
      assert.equal(notFoundRes.body.success, false);

      const badJson = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send('{"email": "broken json');
      assert.equal(badJson.status, 400);
      assert.equal(badJson.body.error.message, "Invalid JSON in request body");
    });

    it("31. Unit-level check for authorizeRoles middleware", () => {
      const middleware = authorizeRoles(UserRole.ADMIN);

      // Case A: Missing req.user -> 401
      let calledNextErr: any = null;
      middleware({} as any, {} as any, (err?: any) => {
        calledNextErr = err;
      });
      assert.ok(calledNextErr);
      assert.equal(calledNextErr.statusCode, 401);
      assert.equal(calledNextErr.message, "Authentication required");

      // Case B: Forbidden role (customer trying admin route) -> 403
      let forbiddenErr: any = null;
      middleware(
        { user: { id: "123", role: UserRole.CUSTOMER } } as any,
        {} as any,
        (err?: any) => {
          forbiddenErr = err;
        }
      );
      assert.ok(forbiddenErr);
      assert.equal(forbiddenErr.statusCode, 403);
      assert.equal(forbiddenErr.message, "Insufficient permissions");

      // Case C: Allowed role -> passes through with next() and no error
      let allowedPassed = false;
      middleware(
        { user: { id: "123", role: UserRole.ADMIN } } as any,
        {} as any,
        (err?: any) => {
          if (!err) allowedPassed = true;
        }
      );
      assert.equal(allowedPassed, true);
    });
  });
});
