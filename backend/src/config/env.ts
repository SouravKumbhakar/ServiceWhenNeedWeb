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

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: parsePort(process.env.PORT, 5000),
  MONGODB_URI: requireString("MONGODB_URI"),
  JWT_SECRET: requireJwtSecret("JWT_SECRET"),
  JWT_EXPIRES_IN: parseJwtExpiresIn(process.env.JWT_EXPIRES_IN, "15m"),
  BCRYPT_SALT_ROUNDS: parseBcryptRounds(process.env.BCRYPT_SALT_ROUNDS, 12),
  // Optional — only required by the test suite, not the app itself
  MONGODB_URI_TEST: process.env.MONGODB_URI_TEST,
} as const;
