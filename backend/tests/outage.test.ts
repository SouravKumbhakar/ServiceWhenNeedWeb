import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { errorHandler } from "../src/middleware/errorHandler.middleware";
import { healthCheck } from "../src/controllers/health.controller";

describe("BUILD 05 — Database Reliability & Outage Behavior Suite (No DB)", () => {
  describe("1. Error Handler 503 Outage Mapping", () => {
    it("Maps MongoServerSelectionError to HTTP 503 Service temporarily unavailable", async () => {
      const testApp = express();
      testApp.get("/db-error", (_req, _res, next) => {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:27017");
        err.name = "MongoServerSelectionError";
        next(err);
      });
      testApp.use(errorHandler);

      const res = await request(testApp).get("/db-error");
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.message, "Service temporarily unavailable");
      assert.strictEqual(res.body.error.statusCode, 503);
      assert.strictEqual(res.body.error.stack, undefined);
    });

    it("Maps MongoNetworkError to HTTP 503 Service temporarily unavailable", async () => {
      const testApp = express();
      testApp.get("/db-error", (_req, _res, next) => {
        const err = new Error("connection closed prematurely");
        err.name = "MongoNetworkError";
        next(err);
      });
      testApp.use(errorHandler);

      const res = await request(testApp).get("/db-error");
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.message, "Service temporarily unavailable");
      assert.strictEqual(res.body.error.statusCode, 503);
    });

    it("Maps Mongoose buffering timeout error to HTTP 503 Service temporarily unavailable", async () => {
      const testApp = express();
      testApp.get("/db-error", (_req, _res, next) => {
        const err = new Error("Operation `users.findOne()` buffering timed out after 5000ms");
        err.name = "MongooseError";
        next(err);
      });
      testApp.use(errorHandler);

      const res = await request(testApp).get("/db-error");
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.message, "Service temporarily unavailable");
      assert.strictEqual(res.body.error.statusCode, 503);
    });
  });

  describe("2. Health Check Behavior During Disconnection", () => {
    it("healthCheck returns status degraded and HTTP 503 when DB is disconnected", async () => {
      const testApp = express();
      testApp.get("/health", healthCheck);

      // In this test file, mongoose is not connected (readyState === 0)
      const res = await request(testApp).get("/health");
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.status, "degraded");
      assert.strictEqual(res.body.database.status, "disconnected");
      assert.strictEqual(typeof res.body.uptime, "number");
      assert.strictEqual(typeof res.body.timestamp, "string");
    });
  });
});
