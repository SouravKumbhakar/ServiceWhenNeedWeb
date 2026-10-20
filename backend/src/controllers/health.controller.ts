import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError";
import { env } from "../config/env";

// Map Mongoose readyState numbers to human-readable strings
const DB_STATE_MAP: Record<number, string> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export async function healthCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const readyState = mongoose.connection.readyState;
    const dbStateLabel = DB_STATE_MAP[readyState] ?? "unknown";

    let dbIsHealthy = false;

    if (readyState === 1) {
      // Do a real ping to confirm the connection is genuinely usable
      try {
        await mongoose.connection.db?.admin().ping();
        dbIsHealthy = true;
      } catch {
        // Ping failed — treat as disconnected
        dbIsHealthy = false;
      }
    }

    const payload = {
      status: dbIsHealthy ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      database: {
        // Use the mapped state label (e.g. "connecting") rather than the number
        status: dbIsHealthy ? "connected" : dbStateLabel,
      },
    };

    res.status(dbIsHealthy ? 200 : 503).json(payload);
  } catch (err) {
    next(err);
  }
}
