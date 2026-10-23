import { Router } from "express";
import { authRouter } from "./auth.routes";
import { bookingRouter } from "./booking.routes";
import healthRouter from "./health.routes";
import { providerRouter } from "./provider.routes";
import { serviceRouter } from "./service.routes";
import { apiLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

// Mount health routes — results in GET /api/health (exempt from rate limiting)
router.use(healthRouter);

// Apply general API rate limiter to all subsequent /api routes
router.use(apiLimiter);

// Mount auth routes — results in /api/auth/*
router.use("/auth", authRouter);

// Mount provider routes — results in /api/providers/*
router.use("/providers", providerRouter);

// Mount service routes — results in /api/services/*
router.use("/services", serviceRouter);

// Mount booking routes — results in /api/bookings/*
router.use("/bookings", bookingRouter);

export default router;
