import express from "express";
import routes from "./routes/index";
import { notFound } from "./middleware/notFound.middleware";
import { errorHandler } from "./middleware/errorHandler.middleware";
import { corsHandler } from "./middleware/cors.middleware";
import { securityHeaders } from "./middleware/securityHeaders.middleware";
import { env } from "./config/env";

const app = express();

// Optional trust proxy configuration (client IP derivation behind reverse proxy)
if (env.TRUST_PROXY !== undefined) {
  app.set("trust proxy", env.TRUST_PROXY);
}

// Remove the default X-Powered-By: Express header
app.disable("x-powered-by");

// Standard security headers (nosniff, DENY, no-referrer, same-site, HSTS in production)
app.use(securityHeaders);

// Hand-written CORS handler driven by CORS_ALLOWED_ORIGINS allowlist
app.use(corsHandler);

// Parse nested query strings (enables object detection for NoSQL operator injection)
app.set("query parser", "extended");

// Parse incoming JSON request bodies (restricted to 10kb to avoid DoS)
app.use(express.json({ limit: "10kb" }));

// All API routes live under /api
app.use("/api", routes);

// Must come after all routes — handles any unmatched path
app.use(notFound);

// Must be the last middleware — 4 params signals it's an error handler to Express
app.use(errorHandler);

export default app;
export { app };
