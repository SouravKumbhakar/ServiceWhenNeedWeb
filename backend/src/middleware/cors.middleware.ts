import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type";
const MAX_AGE = "600";

/**
 * Hand-written CORS middleware driven by CORS_ALLOWED_ORIGINS allowlist.
 * - If Origin matches allowlist: sets Access-Control-Allow-Origin, Vary: Origin,
 *   allowed methods, allowed headers, max-age.
 * - Does NOT set Access-Control-Allow-Credentials (API uses Bearer tokens, not cookies).
 * - Preflight OPTIONS requests receive 204 No Content (with CORS headers if origin allowed,
 *   without CORS headers if origin disallowed).
 */
export function corsHandler(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // If no Origin header, continue normally
  if (!origin) {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
    return;
  }

  const isAllowed = env.CORS_ORIGINS.includes(origin);

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Max-Age", MAX_AGE);
  }

  if (req.method === "OPTIONS") {
    // End preflight request with 204 No Content
    res.status(204).end();
    return;
  }

  next();
}
