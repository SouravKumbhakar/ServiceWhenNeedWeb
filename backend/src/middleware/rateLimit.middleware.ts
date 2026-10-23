import { Request, Response, NextFunction } from "express";
import { rateLimit, Options } from "express-rate-limit";
import { env } from "../config/env";

export interface RateLimiterCustomOptions {
  windowMs?: number;
  max?: number;
  message?: string;
}

/**
 * Factory function to create custom rate limiters.
 * Useful for tests that require low limits without modifying global env.
 */
export function createRateLimiter(options?: RateLimiterCustomOptions) {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = options?.max ?? env.RATE_LIMIT_MAX;
  const message = options?.message ?? "Too many requests, please try again later";

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7", // Return standard RateLimit-* headers
    legacyHeaders: false,        // Disable X-RateLimit-* headers
    handler: (_req: Request, res: Response, _next: NextFunction, _options: Options) => {
      res.status(429).json({
        success: false,
        error: {
          message,
          statusCode: 429,
        },
      });
    },
  });
}

const defaultApiLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
});

const defaultAuthLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
});

/**
 * General API rate limiter for /api routes (health endpoint excluded).
 * In test environment (process.env.NODE_ENV === "test"), bypasses rate limiting
 * so integration suites with hundreds of requests are not throttled.
 */
export function apiLimiter(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") {
    return next();
  }
  defaultApiLimiter(req, res, next);
}

/**
 * Stricter rate limiter for sensitive authentication endpoints (register and login).
 * In test environment (process.env.NODE_ENV === "test"), bypasses rate limiting
 * so integration suites with hundreds of requests are not throttled.
 */
export function authLimiter(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") {
    return next();
  }
  defaultAuthLimiter(req, res, next);
}
