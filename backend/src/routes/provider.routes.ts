import { Router } from "express";
import {
  getMyProfileHandler,
  getPublicProfileHandler,
  listPublicProfilesHandler,
  upsertMyProfileHandler,
} from "../controllers/provider.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";
import { UserRole } from "../models/user.model";

export const providerRouter = Router();

// Provider owner routes (must come BEFORE /:id)
providerRouter.get(
  "/me",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  getMyProfileHandler
);
providerRouter.put(
  "/me",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  upsertMyProfileHandler
);

// Public routes
providerRouter.get("/", listPublicProfilesHandler);
providerRouter.get("/:id", getPublicProfileHandler);
