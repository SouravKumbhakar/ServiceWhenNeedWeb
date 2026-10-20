import express from "express";
import routes from "./routes/index";
import { notFound } from "./middleware/notFound.middleware";
import { errorHandler } from "./middleware/errorHandler.middleware";

const app = express();

// Remove the default X-Powered-By: Express header
app.disable("x-powered-by");

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
