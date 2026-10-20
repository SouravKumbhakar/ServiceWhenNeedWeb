import { Router } from "express";
import {
  createServiceHandler,
  getServiceByIdHandler,
  listMyServicesHandler,
  listPublicServicesHandler,
  setServiceStatusHandler,
  updateServiceHandler,
} from "../controllers/service.controller";
import {
  authenticate,
  authorizeRoles,
  optionalAuthenticate,
} from "../middleware/auth.middleware";
import { UserRole } from "../models/user.model";

export const serviceRouter = Router();

// Provider owner routes
serviceRouter.post(
  "/",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  createServiceHandler
);

// Must come BEFORE /:id
serviceRouter.get(
  "/my",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  listMyServicesHandler
);

// Public browsing routes
serviceRouter.get("/", listPublicServicesHandler);

// Public route with optional authentication
serviceRouter.get("/:id", optionalAuthenticate, getServiceByIdHandler);

// Provider update routes
serviceRouter.patch(
  "/:id",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  updateServiceHandler
);
serviceRouter.patch(
  "/:id/status",
  authenticate,
  authorizeRoles(UserRole.PROVIDER),
  setServiceStatusHandler
);
