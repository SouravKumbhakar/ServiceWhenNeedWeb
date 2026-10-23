import mongoose from "mongoose";
import { env } from "./env";

// Configure Mongoose buffer timeout globally so queries during an outage fail fast
mongoose.set("bufferTimeoutMS", env.BUFFER_TIMEOUT_MS);

// How long (ms) to wait for a server selection before giving up on a connection attempt
const SERVER_SELECTION_TIMEOUT = 5000;

// How long (ms) to wait before retrying after a failed connection
const RETRY_DELAY = 5000;

// Track whether we've established a first successful connection.
// After the first connection Mongoose handles reconnects itself.
let isFirstConnection = true;

async function attemptConnect(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT,
    });
    // On success the "connected" listener below prints the confirmation
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log the connection string — only report that it failed
    console.error(`[Database] Connection attempt failed: ${message}`);
    console.log(`[Database] Retrying in ${RETRY_DELAY / 1000}s...`);
    setTimeout(() => {
      void attemptConnect();
    }, RETRY_DELAY);
  }
}

// Register event listeners once on the shared connection object
mongoose.connection.on("connected", () => {
  if (isFirstConnection) {
    isFirstConnection = false;
    console.log("[Database] Connected to MongoDB.");
  }
});

mongoose.connection.on("disconnected", () => {
  console.warn("[Database] Disconnected from MongoDB.");
});

mongoose.connection.on("error", (err: Error) => {
  console.error(`[Database] Connection error: ${err.message}`);
});

/**
 * Start connecting to MongoDB.
 * Does NOT throw — if MongoDB is unreachable the server stays up and retries.
 */
export async function connectDatabase(): Promise<void> {
  console.log("[Database] Connecting to MongoDB...");
  await attemptConnect();
}

/**
 * Gracefully close the MongoDB connection (used during shutdown).
 */
export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  console.log("[Database] Connection closed.");
}
