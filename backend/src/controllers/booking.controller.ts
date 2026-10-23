import { NextFunction, Request, Response } from "express";
import {
  createBooking,
  getBookingForUser,
  listMyBookings,
  updateBookingStatus,
} from "../services/booking.service";
import { AppError } from "../utils/AppError";
import {
  validateBookingListQuery,
  validateBookingStatusBody,
  validateCreateBookingBody,
  validateObjectIdParam,
} from "../utils/validation";

/**
 * POST /api/bookings
 * Customer creates a pending booking for an active service.
 */
export async function createBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const input = validateCreateBookingBody(req.body);
    const booking = await createBooking(req.user.id, input);

    res.set("Cache-Control", "no-store");
    res.status(201).json({
      success: true,
      data: { booking },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bookings/my
 * Customer or provider sees their own bookings, paginated.
 * Admin is blocked at route level (authorizeRoles).
 */
export async function listMyBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const filters = validateBookingListQuery(req.query as Record<string, unknown>);
    const result = await listMyBookings(req.user, filters);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bookings/:id
 * Owning customer or the provider whose profile matches sees the booking.
 * Anyone else (other customers, other providers, admins) gets 404.
 * Admin is also blocked at route level (authorizeRoles → 403).
 */
export async function getBookingByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = validateObjectIdParam(req.params.id, "id");
    const booking = await getBookingForUser(req.user, id);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: { booking },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/bookings/:id/status
 * Customer or provider (party only) transitions the booking status.
 * Admin is blocked at route level (authorizeRoles → 403).
 */
export async function updateBookingStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = validateObjectIdParam(req.params.id, "id");
    const { status } = validateBookingStatusBody(req.body);
    const booking = await updateBookingStatus(req.user, id, status);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: { booking },
    });
  } catch (error) {
    next(error);
  }
}
