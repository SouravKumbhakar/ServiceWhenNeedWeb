import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

/**
 * Hand-written security headers middleware for a JSON API.
 * Sets standard protection headers without external dependencies like helmet.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // same-site allows resources to be loaded from the same site / domain family
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  if (env.NODE_ENV === "production") {
    // 180 days HSTS header for HTTPS enforcement in production
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains"
    );
  }

  next();
}
