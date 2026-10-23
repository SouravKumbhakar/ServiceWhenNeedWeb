import { Router } from "express";
import {
  createBookingHandler,
  getBookingByIdHandler,
  listMyBookingsHandler,
  updateBookingStatusHandler,
} from "../controllers/booking.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";
import { UserRole } from "../models/user.model";

export const bookingRouter = Router();

// POST /api/bookings — customers only
bookingRouter.post(
  "/",
  authenticate,
  authorizeRoles(UserRole.CUSTOMER),
  createBookingHandler
);

// GET /api/bookings/my — customer or provider
// MUST be defined BEFORE /:id so Express does not treat "my" as a path param.
bookingRouter.get(
  "/my",
  authenticate,
  authorizeRoles(UserRole.CUSTOMER, UserRole.PROVIDER),
  listMyBookingsHandler
);

// PATCH /api/bookings/:id/status — customer or provider (party only)
// Must come before GET /:id so /:id/status is matched by this route.
bookingRouter.patch(
  "/:id/status",
  authenticate,
  authorizeRoles(UserRole.CUSTOMER, UserRole.PROVIDER),
  updateBookingStatusHandler
);

// GET /api/bookings/:id — customer or provider (party only; 404 for anyone else)
bookingRouter.get(
  "/:id",
  authenticate,
  authorizeRoles(UserRole.CUSTOMER, UserRole.PROVIDER),
  getBookingByIdHandler
);
