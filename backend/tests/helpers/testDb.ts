import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { Express } from "express";
import { ProviderProfile } from "../../src/models/providerProfile.model";
import { Service } from "../../src/models/service.model";
import { SafeUser, User, UserRole } from "../../src/models/user.model";

// Fast bcrypt rounds and generated secret for tests
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || "10";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith("replace-with")) {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
}
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/placeholder_db";
}

let dbConnected = false;
let dbSkipReason: string | null = null;

/**
 * Validate that the test database URI is safe to run tests against.
 * Refuses to run if MONGODB_URI_TEST equals MONGODB_URI or if dbName doesn't end in _test.
 */
export function checkTestDbSafety(): void {
  const uri = process.env.MONGODB_URI_TEST;
  if (!uri) {
    dbSkipReason = "MONGODB_URI_TEST not set";
    return;
  }

  if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
    throw new Error("Safety violation: MONGODB_URI_TEST must not equal MONGODB_URI");
  }

  let dbName: string;
  try {
    const url = new URL(uri);
    dbName = url.pathname.replace(/^\//, "").split("/")[0].split("?")[0];
  } catch (err) {
    throw new Error(`Invalid MONGODB_URI_TEST URL: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(`Safety violation: Test database name "${dbName}" must end with "_test"`);
  }
}

/**
 * Connect to the test database and ensure indexes for all models.
 */
export async function setupTestDb(): Promise<{ isAvailable: boolean; skipReason: string | null }> {
  checkTestDbSafety();

  if (dbSkipReason) {
    console.log(`[TEST SUITE] Database tests skipped: ${dbSkipReason}`);
    return { isAvailable: false, skipReason: dbSkipReason };
  }

  const uri = process.env.MONGODB_URI_TEST!;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    dbConnected = true;
    await Promise.all([
      User.init(),
      ProviderProfile.init(),
      Service.init(),
    ]);
    return { isAvailable: true, skipReason: null };
  } catch (error) {
    dbSkipReason = "MongoDB not reachable";
    console.log(`[TEST SUITE] Database tests skipped: ${dbSkipReason}`);
    return { isAvailable: false, skipReason: dbSkipReason };
  }
}

/**
 * Clean up collections without dropping the database.
 */
export async function clearTestDb(): Promise<void> {
  if (dbConnected && mongoose.connection.readyState === 1) {
    await Promise.all([
      Service.deleteMany({}),
      ProviderProfile.deleteMany({}),
      User.deleteMany({}),
    ]);
  }
}

/**
 * Disconnect from MongoDB after test suite finishes.
 */
export async function teardownTestDb(): Promise<void> {
  if (dbConnected) {
    await mongoose.disconnect();
    dbConnected = false;
  }
}

export function getDbSkipReason(): string | null {
  return dbSkipReason;
}

/**
 * Helper to register and log in a user for integration tests.
 */
export async function createAuthenticatedUser(
  app: Express,
  options?: {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
  }
): Promise<{ user: SafeUser; token: string; authHeader: string }> {
  const name = options?.name || "Test User";
  const email =
    options?.email || `user_${crypto.randomBytes(6).toString("hex")}@example.com`;
  const password = options?.password || "Password123";
  const role = options?.role || UserRole.CUSTOMER;

  const regRes = await request(app)
    .post("/api/auth/register")
    .send({ name, email, password, role });

  if (regRes.status !== 201) {
    throw new Error(`Failed to create test user: ${JSON.stringify(regRes.body)}`);
  }

  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email, password });

  if (loginRes.status !== 200) {
    throw new Error(`Failed to log in test user: ${JSON.stringify(loginRes.body)}`);
  }

  const token = loginRes.body.data.token;
  return {
    user: regRes.body.data.user,
    token,
    authHeader: `Bearer ${token}`,
  };
}
