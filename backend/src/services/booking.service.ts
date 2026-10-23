import { IBookingDocument, Booking, BookingStatus, toSafeBooking, SafeBooking } from "../models/booking.model";
import { ProviderProfile } from "../models/providerProfile.model";
import { Service } from "../models/service.model";
import { UserRole } from "../models/user.model";
import { AppError } from "../utils/AppError";
import { BookingListQuery, CreateBookingInput } from "../utils/validation";
import { PaginatedResult } from "./provider.service";

/**
 * Allowed status transitions.
 * Key: "<from>-><to>"
 * Value: the role that may perform this transition.
 *
 * Rules:
 * - Providers can accept, reject, move to in_progress, and complete bookings they own.
 * - Customers can cancel pending or accepted bookings they own.
 * - Terminal states (completed, rejected, cancelled) cannot be left.
 * - No skipping (e.g. pending→completed is invalid).
 */
const ALLOWED_TRANSITIONS: Record<string, UserRole> = {
  "pending->accepted":     UserRole.PROVIDER,
  "pending->rejected":     UserRole.PROVIDER,
  "accepted->in_progress": UserRole.PROVIDER,
  "in_progress->completed":UserRole.PROVIDER,
  "pending->cancelled":    UserRole.CUSTOMER,
  "accepted->cancelled":   UserRole.CUSTOMER,
};

/**
 * Status values that each role can EVER set (used to distinguish 403 from 409).
 * If the requested status is not in this set for the caller's role, return 403.
 * If the status is in the set but the current->new transition is not in the table, return 409.
 */
const ROLE_SETTABLE_STATUSES: Record<UserRole, Set<BookingStatus>> = {
  [UserRole.PROVIDER]: new Set(["accepted", "rejected", "in_progress", "completed"]),
  [UserRole.CUSTOMER]: new Set(["cancelled"]),
  [UserRole.ADMIN]:    new Set(),
};

/**
 * Create a booking for a customer.
 * Snapshots serviceTitle and basePrice from the service document.
 * Returns 404 for nonexistent or inactive services (does not leak existence).
 */
export async function createBooking(
  customerUserId: string,
  data: CreateBookingInput
): Promise<SafeBooking> {
  // 1. Load the service — both inactive and nonexistent return the same 404
  const service = await Service.findById(data.serviceId);
  if (!service || !service.isActive) {
    throw new AppError("Service not found", 404);
  }

  // 2. Load the provider profile for this service
  const profile = await ProviderProfile.findById(service.provider);
  if (!profile || !profile.isActive) {
    throw new AppError("Service not found", 404);
  }

  // 3. Create the booking with snapshots and trusted identity
  const booking = await Booking.create({
    customerId:         customerUserId,
    serviceId:          service._id,
    providerId:         profile._id,
    serviceTitle:       service.title,    // snapshot
    basePrice:          service.basePrice, // snapshot
    serviceAddress:     data.serviceAddress,
    city:               data.city,
    scheduledAt:        data.scheduledAt,
    problemDescription: data.problemDescription,
    status:             "pending",
  });

  return toSafeBooking(booking);
}

/**
 * List bookings for the authenticated user.
 * - customer: returns bookings where customerId === caller.
 * - provider: resolves the caller's profile; empty list (not error) if no profile.
 * - admin: unreachable here (blocked at route by authorizeRoles).
 */
export async function listMyBookings(
  user: { id: string; role: UserRole },
  filters: BookingListQuery
): Promise<PaginatedResult<SafeBooking>> {
  const { page, limit, status } = filters;
  const skip = (page - 1) * limit;

  let matchFilter: Record<string, unknown>;

  if (user.role === UserRole.CUSTOMER) {
    matchFilter = { customerId: user.id };
  } else {
    // provider role
    const profile = await ProviderProfile.findOne({ user: user.id });
    if (!profile) {
      // Provider has no profile — return empty paginated result, not an error
      return {
        items: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
      };
    }
    matchFilter = { providerId: profile._id };
  }

  // Optional status filter
  if (status) {
    matchFilter.status = status;
  }

  const [total, bookings] = await Promise.all([
    Booking.countDocuments(matchFilter),
    Booking.find(matchFilter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items: bookings.map(toSafeBooking),
    pagination: { page, limit, total, totalPages },
  };
}

/**
 * Get a single booking.
 * Allowed only for the owning customer or the provider whose profile matches.
 * Any other caller (other customers, other providers, admins) gets 404 to avoid existence disclosure.
 * Admin is blocked at the route level (authorizeRoles); this function only handles customer/provider.
 */
export async function getBookingForUser(
  user: { id: string; role: UserRole },
  bookingId: string
): Promise<SafeBooking> {
  let matchFilter: Record<string, unknown> = { _id: bookingId };

  if (user.role === UserRole.CUSTOMER) {
    matchFilter.customerId = user.id;
  } else {
    // provider
    const profile = await ProviderProfile.findOne({ user: user.id });
    if (!profile) {
      throw new AppError("Booking not found", 404);
    }
    matchFilter.providerId = profile._id;
  }

  const booking = await Booking.findOne(matchFilter).lean();
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  return toSafeBooking(booking);
}

/**
 * Update booking status.
 * Uses atomic findOneAndUpdate to guard against concurrent modifications.
 *
 * Authorization semantics:
 * 1. Route already enforced authenticate + authorizeRoles("customer","provider").
 * 2. Load booking with ownership filter — mismatch → 404.
 * 3. If requested status is not in the role's settable set → 403.
 * 4. If status is in the set but the current→new transition is not in the table → 409.
 * 5. Apply atomically using the current status as part of the filter.
 *    If the atomic update returns null the booking still exists but status changed → 409.
 */
export async function updateBookingStatus(
  user: { id: string; role: UserRole },
  bookingId: string,
  newStatus: BookingStatus
): Promise<SafeBooking> {
  // Check that this role can ever set this status (403 if not)
  const settable = ROLE_SETTABLE_STATUSES[user.role];
  if (!settable || !settable.has(newStatus)) {
    throw new AppError("Insufficient permissions", 403);
  }

  // Build ownership filter
  let ownerFilter: Record<string, unknown>;

  if (user.role === UserRole.CUSTOMER) {
    ownerFilter = { _id: bookingId, customerId: user.id };
  } else {
    // provider
    const profile = await ProviderProfile.findOne({ user: user.id });
    if (!profile) {
      throw new AppError("Booking not found", 404);
    }
    ownerFilter = { _id: bookingId, providerId: profile._id };
  }

  // Load booking with ownership check
  const booking = await Booking.findOne(ownerFilter);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  const currentStatus = booking.status;
  const transitionKey = `${currentStatus}->${newStatus}`;

  // Check if this exact transition is in the table
  if (!(transitionKey in ALLOWED_TRANSITIONS)) {
    throw new AppError(
      `Cannot change booking status from ${currentStatus} to ${newStatus}`,
      409
    );
  }

  // Verify the role matches the transition's required role
  if (ALLOWED_TRANSITIONS[transitionKey] !== user.role) {
    throw new AppError(
      `Cannot change booking status from ${currentStatus} to ${newStatus}`,
      409
    );
  }

  // Atomic update: the status must still be currentStatus (concurrency guard)
  const updated = await Booking.findOneAndUpdate(
    { ...ownerFilter, status: currentStatus },
    { $set: { status: newStatus } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    // Status changed concurrently
    throw new AppError("Booking status has changed; please retry", 409);
  }

  return toSafeBooking(updated);
}
