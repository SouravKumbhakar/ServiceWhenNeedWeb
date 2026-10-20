import { Router } from "express";
import { authRouter } from "./auth.routes";
import healthRouter from "./health.routes";
import { providerRouter } from "./provider.routes";
import { serviceRouter } from "./service.routes";

const router = Router();

// Mount health routes — results in GET /api/health
router.use(healthRouter);

// Mount auth routes — results in /api/auth/*
router.use("/auth", authRouter);

// Mount provider routes — results in /api/providers/*
router.use("/providers", providerRouter);

// Mount service routes — results in /api/services/*
router.use("/services", serviceRouter);

export default router;
