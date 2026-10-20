import { Router } from "express";
import { healthCheck } from "../controllers/health.controller";

const router = Router();

// GET /api/health
router.get("/health", healthCheck);

export default router;
