import http from "http";

// env.ts calls dotenv.config() at import time — must be the very first import
import { env } from "./config/env";
import app from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";

const server = http.createServer(app);

// Start listening — do this before connecting to MongoDB so the health
// endpoint is available even while the database is still starting up.
server.listen(env.PORT, () => {
  console.log(
    `[Server] Running in ${env.NODE_ENV} mode on http://localhost:${env.PORT}`
  );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[Server] Port ${env.PORT} is already in use. ` +
        `Stop the other process or change PORT in .env.`
    );
    process.exit(1);
  }
  // Re-throw anything else so it surfaces as an unhandled error
  throw err;
});

// Connect to MongoDB without awaiting — failures are handled inside connectDatabase()
connectDatabase().catch(() => {
  // Errors are already logged inside connectDatabase; nothing more to do here.
});

// --- Graceful shutdown ---

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  // Force-exit if shutdown takes more than 10 seconds
  const forceExit = setTimeout(() => {
    console.error("[Server] Forced exit after timeout.");
    process.exit(1);
  }, 10_000);
  forceExit.unref(); // Don't keep the process alive just for this timer

  server.close(async () => {
    console.log("[Server] HTTP server closed.");
    try {
      await disconnectDatabase();
    } catch (err) {
      console.error("[Server] Error during database disconnect:", err);
    }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
