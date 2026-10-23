import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

interface CustomError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
  code?: number;
}

/**
 * Central error handler (must have 4 parameters for Express to recognise it).
 * Always responds with JSON so clients get a consistent error shape.
 */
export function errorHandler(
  err: CustomError | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // --- Malformed JSON body (express body-parser throws this) ---
  if ("type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      error: {
        message: "Invalid JSON in request body",
        statusCode: 400,
      },
    });
    return;
  }

  // --- Oversized request body ---
  if ("type" in err && err.type === "entity.too.large") {
    res.status(413).json({
      success: false,
      error: {
        message: "Request body too large",
        statusCode: 413,
      },
    });
    return;
  }

  // --- Operational errors created with AppError ---
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
    return;
  }

  const errObj = err as CustomError;

  // --- Database outage / connection failure / buffering timeout (503) ---
  const isDbOutage =
    errObj.name === "MongoNetworkError" ||
    errObj.name === "MongoServerSelectionError" ||
    errObj.name === "MongooseServerSelectionError" ||
    errObj.name === "MongoTimeoutError" ||
    errObj.name === "MongoTopologyClosedError" ||
    (typeof errObj.message === "string" && /buffering timed out/i.test(errObj.message));

  if (isDbOutage) {
    res.status(503).json({
      success: false,
      error: {
        message: "Service temporarily unavailable",
        statusCode: 503,
      },
    });
    return;
  }

  // --- Unhandled MongoDB duplicate-key error ---
  if (errObj.code === 11000) {
    res.status(409).json({
      success: false,
      error: {
        message: "Resource already exists",
        statusCode: 409,
      },
    });
    return;
  }

  // --- Mongoose validation error ---
  if (errObj.name === "ValidationError") {
    res.status(400).json({
      success: false,
      error: {
        message: "Validation failed",
        statusCode: 400,
      },
    });
    return;
  }

  // --- Mongoose CastError (e.g. invalid ObjectId) ---
  if (errObj.name === "CastError") {
    res.status(400).json({
      success: false,
      error: {
        message: "Invalid value",
        statusCode: 400,
      },
    });
    return;
  }

  // --- Unexpected errors (500) ---
  console.error("[ErrorHandler] Unexpected error:", err);

  const isProduction = env.NODE_ENV === "production";
  const message = isProduction ? "Internal server error" : (err.message ?? "Internal server error");

  const errorBody: Record<string, unknown> = {
    message,
    statusCode: 500,
  };

  // Never expose stack traces in production
  if (!isProduction && err.stack) {
    errorBody.stack = err.stack;
  }

  res.status(500).json({ success: false, error: errorBody });
}
