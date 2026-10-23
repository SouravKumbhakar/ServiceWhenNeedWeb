import dotenv from "dotenv";

// Load variables from .env into process.env before anything reads them
dotenv.config();

function requireString(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in your .env file (see .env.example).`
    );
  }
  return value;
}

function parsePort(raw: string | undefined, defaultPort: number): number {
  if (raw === undefined || raw === "") return defaultPort;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Environment variable PORT must be a valid integer between 1 and 65535. Got: "${raw}"`
    );
  }
  return parsed;
}

function requireJwtSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    );
  }
  // Catch the placeholder from .env.example before it is accidentally used
  if (value.startsWith("replace-with")) {
    throw new Error(
      `${name} is still set to the placeholder value from .env.example. ` +
        `Generate a real secret with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    );
  }
  if (value.length < 32) {
    throw new Error(
      `${name} must be at least 32 characters long (current length: ${value.length}). ` +
        `The actual secret value is not printed for security.`
    );
  }
  return value;
}

function parseJwtExpiresIn(raw: string | undefined, defaultVal: string): string {
  const value = raw ?? defaultVal;
  if (!/^\d+[smhd]$/.test(value)) {
    throw new Error(
      `JWT_EXPIRES_IN must match the pattern <number><unit> where unit is s, m, h, or d. ` +
        `Got: "${value}"`
    );
  }
  return value;
}

function parseBcryptRounds(raw: string | undefined, defaultVal: number): number {
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 10 || parsed > 14) {
    throw new Error(
      `BCRYPT_SALT_ROUNDS must be an integer between 10 and 14. Got: "${raw}"`
    );
  }
  return parsed;
}

function parsePositiveInt(name: string, raw: string | undefined, defaultVal: number): number {
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer. Got: "${raw}"`
    );
  }
  return parsed;
}

/**
 * Pure helper to parse and validate CORS_ALLOWED_ORIGINS.
 * Throws on wildcard '*', paths, trailing slashes, or invalid URLs.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry === "*") {
      throw new Error(
        "Wildcard '*' is not permitted in CORS_ALLOWED_ORIGINS. Specify exact origins (e.g. http://localhost:5173)."
      );
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(
        `Invalid CORS origin: "${entry}". Must be a valid absolute URL (e.g. http://localhost:5173).`
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `Invalid CORS origin protocol: "${entry}". Only http: and https: are permitted.`
      );
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      throw new Error(`CORS origin must not include a path: "${entry}".`);
    }
    if (entry.endsWith("/")) {
      throw new Error(`CORS origin must not include a trailing slash: "${entry}".`);
    }
  }
  return entries;
}

function parseTrustProxy(raw: string | undefined): string | number | boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 0) return num;
  return raw.trim();
}

const rawCors = process.env.CORS_ALLOWED_ORIGINS;
const parsedCorsOrigins = parseAllowedOrigins(rawCors);

// Warn if production has no CORS origins configured
if ((process.env.NODE_ENV ?? "development") === "production" && parsedCorsOrigins.length === 0) {
  console.warn("[CORS] Warning: CORS_ALLOWED_ORIGINS is not set in production. Cross-origin requests will be blocked.");
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: parsePort(process.env.PORT, 5000),
  MONGODB_URI: requireString("MONGODB_URI"),
  JWT_SECRET: requireJwtSecret("JWT_SECRET"),
  JWT_EXPIRES_IN: parseJwtExpiresIn(process.env.JWT_EXPIRES_IN, "15m"),
  BCRYPT_SALT_ROUNDS: parseBcryptRounds(process.env.BCRYPT_SALT_ROUNDS, 12),
  // Optional — only required by the test suite, not the app itself
  MONGODB_URI_TEST: process.env.MONGODB_URI_TEST,
  // Rate limiting (safe defaults: 15m window, 300 general max, 20 auth max)
  RATE_LIMIT_WINDOW_MS: parsePositiveInt("RATE_LIMIT_WINDOW_MS", process.env.RATE_LIMIT_WINDOW_MS, 900_000),
  RATE_LIMIT_MAX: parsePositiveInt("RATE_LIMIT_MAX", process.env.RATE_LIMIT_MAX, 300),
  AUTH_RATE_LIMIT_MAX: parsePositiveInt("AUTH_RATE_LIMIT_MAX", process.env.AUTH_RATE_LIMIT_MAX, 20),
  // CORS allowlist
  CORS_ALLOWED_ORIGINS: rawCors,
  CORS_ORIGINS: parsedCorsOrigins,
  // Reverse proxy IP derivation
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  // Database buffering timeout in ms
  BUFFER_TIMEOUT_MS: parsePositiveInt("BUFFER_TIMEOUT_MS", process.env.BUFFER_TIMEOUT_MS, 5000),
} as const;
