import mongoose from "mongoose";
import {
  BOOKING_STATUSES,
  BookingStatus,
} from "../models/booking.model";
import {
  PROVIDER_TYPES,
  ProviderType,
} from "../models/providerProfile.model";
import {
  SERVICE_CATEGORIES,
  ServiceCategory,
} from "../models/service.model";
import { UserRole } from "../models/user.model";
import { AppError } from "./AppError";

// Simple email regex — good enough for API validation (not RFC 5321 complete)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fields extracted from a registration request body. */
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

/** Fields extracted from a login request body. */
export interface LoginInput {
  email: string;
  password: string;
}

/** Fields extracted from a provider profile create/update request body. */
export interface UpsertProviderProfileInput {
  providerType: ProviderType;
  displayName: string;
  phone: string;
  address: string;
  city: string;
  description?: string;
}

/** Fields extracted from a service create request body. */
export interface CreateServiceInput {
  title: string;
  description: string;
  category: ServiceCategory;
  basePrice: number;
  isActive?: boolean;
}

/** Fields extracted from a service update request body. */
export interface UpdateServiceInput {
  title?: string;
  description?: string;
  category?: ServiceCategory;
  basePrice?: number;
}

/** Query parameters for listing providers. */
export interface ProviderListQuery {
  city?: string;
  providerType?: ProviderType;
  q?: string;
  page: number;
  limit: number;
}

/** Query parameters for listing services. */
export interface ServiceListQuery {
  category?: ServiceCategory;
  city?: string;
  q?: string;
  page: number;
  limit: number;
}

function badRequest(message: string): AppError {
  return new AppError(message, 400);
}

/**
 * Escape regular expression special characters to safely match literally in RegExp.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate that an ID path parameter is a valid 24-character hex MongoDB ObjectId.
 */
export function validateObjectIdParam(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{24}$/.test(value) ||
    !mongoose.isValidObjectId(value)
  ) {
    throw badRequest(`Invalid ${name}`);
  }
  return value;
}

/**
 * Validate and extract registration fields from a raw request body.
 */
export function validateRegisterBody(body: unknown): RegisterInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // --- name ---
  const rawName = raw["name"];
  if (rawName === undefined) throw badRequest("name is required");
  if (typeof rawName !== "string") throw badRequest("name must be a string");
  const name = rawName.trim();
  if (name.length < 2) throw badRequest("name must be at least 2 characters");
  if (name.length > 100) throw badRequest("name must be at most 100 characters");

  // --- email ---
  const rawEmail = raw["email"];
  if (rawEmail === undefined) throw badRequest("email is required");
  if (typeof rawEmail !== "string") throw badRequest("email must be a string");
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) throw badRequest("email is not valid");
  if (email.length > 254) throw badRequest("email must be at most 254 characters");

  // --- password ---
  const rawPassword = raw["password"];
  if (rawPassword === undefined) throw badRequest("password is required");
  if (typeof rawPassword !== "string") throw badRequest("password must be a string");
  const password = rawPassword;
  if (password.length < 8) throw badRequest("password must be at least 8 characters");
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw badRequest("password must not exceed 72 bytes");
  }
  if (!/[a-zA-Z]/.test(password)) throw badRequest("password must contain at least one letter");
  if (!/[0-9]/.test(password)) throw badRequest("password must contain at least one number");

  // --- role (optional, whitelist only customer/provider) ---
  const rawRole = raw["role"];
  let role: UserRole = UserRole.CUSTOMER;
  if (rawRole !== undefined) {
    if (typeof rawRole !== "string") throw badRequest("role must be a string");
    if (rawRole !== UserRole.CUSTOMER && rawRole !== UserRole.PROVIDER) {
      throw badRequest(`Invalid role. Allowed roles: customer, provider`);
    }
    role = rawRole as UserRole;
  }

  return { name, email, password, role };
}

/**
 * Validate and extract login fields from a raw request body.
 */
export function validateLoginBody(body: unknown): LoginInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // --- email ---
  const rawEmail = raw["email"];
  if (rawEmail === undefined) throw badRequest("email is required");
  if (typeof rawEmail !== "string") throw badRequest("email must be a string");
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) throw badRequest("email is not valid");
  if (email.length > 254) throw badRequest("email must be at most 254 characters");

  // --- password ---
  const rawPassword = raw["password"];
  if (rawPassword === undefined) throw badRequest("password is required");
  if (typeof rawPassword !== "string") throw badRequest("password must be a string");
  const password = rawPassword;
  if (password.length === 0) throw badRequest("password is required");
  if (password.length > 128) throw badRequest("password is too long");

  return { email, password };
}

/**
 * Normalize and validate phone numbers.
 * Allows digits, spaces, +, -, (, ).
 * After stripping spaces/dashes/parentheses: 7-15 characters, optional leading +, digits only.
 */
export function normalizePhone(raw: unknown): string {
  if (raw === undefined || raw === null) throw badRequest("phone is required");
  if (typeof raw !== "string") throw badRequest("phone must be a string");

  const trimmed = raw.trim();
  if (trimmed.length === 0) throw badRequest("phone is required");

  if (!/^[\d\s+\-()]+$/.test(trimmed)) {
    throw badRequest("Invalid phone number format");
  }

  const cleaned = trimmed.replace(/[\s\-()]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) {
    throw badRequest("Invalid phone number format");
  }

  if (cleaned.length < 7 || cleaned.length > 15) {
    throw badRequest("Phone number must be between 7 and 15 digits");
  }

  return cleaned;
}

/**
 * Validate provider profile create/update body (PUT /api/providers/me).
 * Whitelists only providerType, displayName, phone, address, city, description.
 */
export function validateProviderProfileBody(
  body: unknown
): UpsertProviderProfileInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // providerType
  const rawType = raw["providerType"];
  if (rawType === undefined) throw badRequest("providerType is required");
  if (typeof rawType !== "string") throw badRequest("providerType must be a string");
  if (!PROVIDER_TYPES.includes(rawType as ProviderType)) {
    throw badRequest("Invalid providerType. Allowed values: individual, company");
  }
  const providerType = rawType as ProviderType;

  // displayName
  const rawName = raw["displayName"];
  if (rawName === undefined) throw badRequest("displayName is required");
  if (typeof rawName !== "string") throw badRequest("displayName must be a string");
  const displayName = rawName.trim();
  if (displayName.length < 2 || displayName.length > 100) {
    throw badRequest("displayName must be between 2 and 100 characters");
  }

  // phone
  const phone = normalizePhone(raw["phone"]);

  // address
  const rawAddress = raw["address"];
  if (rawAddress === undefined) throw badRequest("address is required");
  if (typeof rawAddress !== "string") throw badRequest("address must be a string");
  const address = rawAddress.trim();
  if (address.length < 5 || address.length > 200) {
    throw badRequest("address must be between 5 and 200 characters");
  }

  // city
  const rawCity = raw["city"];
  if (rawCity === undefined) throw badRequest("city is required");
  if (typeof rawCity !== "string") throw badRequest("city must be a string");
  const city = rawCity.trim();
  if (city.length < 2 || city.length > 80) {
    throw badRequest("city must be between 2 and 80 characters");
  }

  // description (optional)
  let description: string | undefined = undefined;
  if (raw["description"] !== undefined && raw["description"] !== null) {
    if (typeof raw["description"] !== "string") {
      throw badRequest("description must be a string");
    }
    const trimmedDesc = raw["description"].trim();
    if (trimmedDesc.length > 1000) {
      throw badRequest("description must be at most 1000 characters");
    }
    description = trimmedDesc.length > 0 ? trimmedDesc : undefined;
  }

  return {
    providerType,
    displayName,
    phone,
    address,
    city,
    description,
  };
}

/**
 * Validate basePrice rules.
 * Number, finite, not NaN, >= 0, <= 10000000, at most 2 decimal places.
 */
export function validateBasePrice(val: unknown): number {
  if (val === undefined || val === null) {
    throw badRequest("basePrice is required");
  }
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    throw badRequest("basePrice must be a number");
  }
  if (val < 0) {
    throw badRequest("basePrice cannot be negative");
  }
  if (val > 10000000) {
    throw badRequest("basePrice cannot exceed 10000000");
  }
  if (Math.abs(val * 100 - Math.round(val * 100)) >= 1e-9) {
    throw badRequest("basePrice can have at most 2 decimal places");
  }
  return val;
}

/**
 * Validate service create body (POST /api/services).
 */
export function validateCreateServiceBody(body: unknown): CreateServiceInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // title
  const rawTitle = raw["title"];
  if (rawTitle === undefined) throw badRequest("title is required");
  if (typeof rawTitle !== "string") throw badRequest("title must be a string");
  const title = rawTitle.trim();
  if (title.length < 3 || title.length > 120) {
    throw badRequest("title must be between 3 and 120 characters");
  }

  // description
  const rawDesc = raw["description"];
  if (rawDesc === undefined) throw badRequest("description is required");
  if (typeof rawDesc !== "string") throw badRequest("description must be a string");
  const description = rawDesc.trim();
  if (description.length < 10 || description.length > 2000) {
    throw badRequest("description must be between 10 and 2000 characters");
  }

  // category
  const rawCat = raw["category"];
  if (rawCat === undefined) throw badRequest("category is required");
  if (typeof rawCat !== "string") throw badRequest("category must be a string");
  const categoryLower = rawCat.trim().toLowerCase();
  if (!SERVICE_CATEGORIES.includes(categoryLower as ServiceCategory)) {
    throw badRequest(`Invalid category. Allowed categories: ${SERVICE_CATEGORIES.join(", ")}`);
  }
  const category = categoryLower as ServiceCategory;

  // basePrice
  const basePrice = validateBasePrice(raw["basePrice"]);

  // isActive (optional boolean)
  let isActive: boolean | undefined = undefined;
  if (raw["isActive"] !== undefined && raw["isActive"] !== null) {
    if (typeof raw["isActive"] !== "boolean") {
      throw badRequest("isActive must be a boolean");
    }
    isActive = raw["isActive"];
  }

  return {
    title,
    description,
    category,
    basePrice,
    isActive,
  };
}

/**
 * Validate service update body (PATCH /api/services/:id).
 */
export function validateUpdateServiceBody(body: unknown): UpdateServiceInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;
  const updateData: UpdateServiceInput = {};

  if (raw["title"] !== undefined) {
    if (typeof raw["title"] !== "string") throw badRequest("title must be a string");
    const title = raw["title"].trim();
    if (title.length < 3 || title.length > 120) {
      throw badRequest("title must be between 3 and 120 characters");
    }
    updateData.title = title;
  }

  if (raw["description"] !== undefined) {
    if (typeof raw["description"] !== "string") throw badRequest("description must be a string");
    const description = raw["description"].trim();
    if (description.length < 10 || description.length > 2000) {
      throw badRequest("description must be between 10 and 2000 characters");
    }
    updateData.description = description;
  }

  if (raw["category"] !== undefined) {
    if (typeof raw["category"] !== "string") throw badRequest("category must be a string");
    const categoryLower = raw["category"].trim().toLowerCase();
    if (!SERVICE_CATEGORIES.includes(categoryLower as ServiceCategory)) {
      throw badRequest(`Invalid category. Allowed categories: ${SERVICE_CATEGORIES.join(", ")}`);
    }
    updateData.category = categoryLower as ServiceCategory;
  }

  if (raw["basePrice"] !== undefined) {
    updateData.basePrice = validateBasePrice(raw["basePrice"]);
  }

  if (Object.keys(updateData).length === 0) {
    throw badRequest("No valid fields to update");
  }

  return updateData;
}

/**
 * Validate service status body (PATCH /api/services/:id/status).
 */
export function validateServiceStatusBody(body: unknown): { isActive: boolean } {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;
  if (raw["isActive"] === undefined) {
    throw badRequest("isActive is required");
  }
  if (typeof raw["isActive"] !== "boolean") {
    throw badRequest("isActive must be a boolean");
  }

  return { isActive: raw["isActive"] };
}

/**
 * Helper to validate query parameter string and pagination.
 */
export function parsePaginationParams(query: Record<string, unknown>): {
  page: number;
  limit: number;
} {
  for (const [key, val] of Object.entries(query)) {
    if (
      key.includes("[") ||
      key.includes("$") ||
      (val !== undefined && typeof val !== "string")
    ) {
      throw badRequest(`Invalid query parameter: ${key}`);
    }
  }

  let page = 1;
  let limit = 10;

  if (query.page !== undefined) {
    if (typeof query.page !== "string") throw badRequest("Invalid query parameter: page");
    if (!/^\d+$/.test(query.page)) throw badRequest("page must be a positive integer");
    page = parseInt(query.page, 10);
    if (page < 1 || page > 10000) throw badRequest("page must be between 1 and 10000");
  }

  if (query.limit !== undefined) {
    if (typeof query.limit !== "string") throw badRequest("Invalid query parameter: limit");
    if (!/^\d+$/.test(query.limit)) throw badRequest("limit must be a positive integer");
    limit = parseInt(query.limit, 10);
    if (limit < 1 || limit > 50) throw badRequest("limit must be between 1 and 50");
  }

  return { page, limit };
}

/**
 * Validate query parameters for GET /api/providers.
 */
export function validateProviderListQuery(
  query: Record<string, unknown>
): ProviderListQuery {
  const { page, limit } = parsePaginationParams(query);

  let city: string | undefined = undefined;
  if (query.city !== undefined) {
    if (typeof query.city !== "string") throw badRequest("Invalid query parameter: city");
    const trimmed = query.city.trim().toLowerCase();
    if (trimmed.length < 1 || trimmed.length > 80) {
      throw badRequest("city must be between 1 and 80 characters");
    }
    city = trimmed;
  }

  let providerType: ProviderType | undefined = undefined;
  if (query.providerType !== undefined) {
    if (typeof query.providerType !== "string") throw badRequest("Invalid query parameter: providerType");
    const trimmed = query.providerType.trim().toLowerCase();
    if (!PROVIDER_TYPES.includes(trimmed as ProviderType)) {
      throw badRequest("Invalid providerType. Allowed values: individual, company");
    }
    providerType = trimmed as ProviderType;
  }

  let q: string | undefined = undefined;
  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw badRequest("Invalid query parameter: q");
    const trimmed = query.q.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      throw badRequest("q must be between 1 and 100 characters");
    }
    q = trimmed;
  }

  return { city, providerType, q, page, limit };
}

/**
 * Validate query parameters for GET /api/services.
 */
export function validateServiceListQuery(
  query: Record<string, unknown>
): ServiceListQuery {
  const { page, limit } = parsePaginationParams(query);

  let category: ServiceCategory | undefined = undefined;
  if (query.category !== undefined) {
    if (typeof query.category !== "string") throw badRequest("Invalid query parameter: category");
    const trimmed = query.category.trim().toLowerCase();
    if (!SERVICE_CATEGORIES.includes(trimmed as ServiceCategory)) {
      throw badRequest(`Invalid category. Allowed categories: ${SERVICE_CATEGORIES.join(", ")}`);
    }
    category = trimmed as ServiceCategory;
  }

  let city: string | undefined = undefined;
  if (query.city !== undefined) {
    if (typeof query.city !== "string") throw badRequest("Invalid query parameter: city");
    const trimmed = query.city.trim().toLowerCase();
    if (trimmed.length < 1 || trimmed.length > 80) {
      throw badRequest("city must be between 1 and 80 characters");
    }
    city = trimmed;
  }

  let q: string | undefined = undefined;
  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw badRequest("Invalid query parameter: q");
    const trimmed = query.q.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      throw badRequest("q must be between 1 and 100 characters");
    }
    q = trimmed;
  }

  return { category, city, q, page, limit };
}

export { UserRole };

// ---------------------------------------------------------------------------
// Booking validation — strict ISO 8601 with timezone, future, 365-day bound
// ---------------------------------------------------------------------------

/**
 * ISO 8601 datetime with REQUIRED explicit timezone designator.
 * Accepts: 2030-06-15T10:30:00Z  or  2030-06-15T16:00:00+05:30
 * Rejects: date-only "2030-06-15", no-timezone "2030-06-15T10:00:00", numbers.
 */
const ISO_WITH_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Maximum milliseconds in the future a booking can be scheduled (365 days).
 */
const MAX_SCHEDULED_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Parse and validate a scheduledAt string.
 * - Must be a string (not a number, not an array/object).
 * - Must match ISO 8601 format with explicit Z or +hh:mm/-hh:mm timezone.
 * - Must be a valid calendar date (e.g. Feb 31 rejected).
 * - Must be strictly in the future (> now).
 * - Must not be more than 365 days in the future.
 * Returns the parsed Date on success; throws AppError 400 on failure.
 */
export function validateScheduledAt(value: unknown): Date {
  const MSG =
    'scheduledAt must be an ISO 8601 string with an explicit timezone (e.g. "2030-06-15T10:30:00Z" or "2030-06-15T16:00:00+05:30")';

  if (value === undefined || value === null) throw badRequest("scheduledAt is required");
  if (typeof value !== "string") throw badRequest(MSG);
  if (!ISO_WITH_TZ_REGEX.test(value)) throw badRequest(MSG);

  // Parse to Date
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) throw badRequest(MSG);

  // Validate calendar date by round-tripping the UTC components for Z suffix,
  // or by verifying JS did not silently roll over the month (e.g. Feb 31).
  // Strategy: re-format the parsed date back to a normalised ISO and compare
  // the date part. If the input was "2030-02-31T10:00:00Z", JS rolls it to
  // "2030-03-03T10:00:00.000Z" — so the date parts won't match.
  const inputDatePart = value.substring(0, 10); // "YYYY-MM-DD"
  const parsedDatePart = parsed.toISOString().substring(0, 10);

  // For UTC ("Z"), the date part can be compared directly.
  // For +offset, the parsed UTC time shifts. We reconstruct the local date
  // from the offset to check rollover.
  const tzMatch = value.match(/(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!tzMatch) throw badRequest(MSG);

  if (tzMatch[1] === "Z") {
    // UTC: date parts must match exactly
    if (parsedDatePart !== inputDatePart) {
      throw badRequest("scheduledAt contains an invalid calendar date");
    }
  } else {
    // Offset: calculate what the local date should be
    const sign = tzMatch[2] === "+" ? 1 : -1;
    const offsetMinutes = sign * (parseInt(tzMatch[3], 10) * 60 + parseInt(tzMatch[4], 10));
    // Adjust parsed UTC back to local time to get the local date
    const localMs = parsed.getTime() + offsetMinutes * 60 * 1000;
    const localDate = new Date(localMs);
    const localDatePart = localDate.toISOString().substring(0, 10);
    if (localDatePart !== inputDatePart) {
      throw badRequest("scheduledAt contains an invalid calendar date");
    }
  }

  const now = Date.now();
  if (parsed.getTime() <= now) {
    throw badRequest("scheduledAt must be in the future");
  }
  if (parsed.getTime() - now > MAX_SCHEDULED_MS) {
    throw badRequest("scheduledAt must not be more than 365 days in the future");
  }

  return parsed;
}

/** Fields extracted from a booking create request body. */
export interface CreateBookingInput {
  serviceId: string;
  serviceAddress: string;
  city: string;
  scheduledAt: Date;
  problemDescription?: string;
}

/**
 * Validate POST /api/bookings request body.
 * Whitelists: serviceId, serviceAddress, city, scheduledAt, problemDescription.
 * Silently ignores: customerId, providerId, serviceTitle, basePrice, status, _id, and anything else.
 */
export function validateCreateBookingBody(body: unknown): CreateBookingInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // serviceId — must be a string and a valid 24-char hex ObjectId
  const rawServiceId = raw["serviceId"];
  if (rawServiceId === undefined) throw badRequest("serviceId is required");
  if (typeof rawServiceId !== "string") throw badRequest("Invalid serviceId");
  if (!/^[0-9a-fA-F]{24}$/.test(rawServiceId) || !mongoose.isValidObjectId(rawServiceId)) {
    throw badRequest("Invalid serviceId");
  }

  // serviceAddress — required, 5–200 chars
  const rawAddress = raw["serviceAddress"];
  if (rawAddress === undefined) throw badRequest("serviceAddress is required");
  if (typeof rawAddress !== "string") throw badRequest("serviceAddress must be a string");
  const serviceAddress = rawAddress.trim();
  if (serviceAddress.length < 5 || serviceAddress.length > 200) {
    throw badRequest("serviceAddress must be between 5 and 200 characters");
  }

  // city — required, 2–80 chars
  const rawCity = raw["city"];
  if (rawCity === undefined) throw badRequest("city is required");
  if (typeof rawCity !== "string") throw badRequest("city must be a string");
  const city = rawCity.trim();
  if (city.length < 2 || city.length > 80) {
    throw badRequest("city must be between 2 and 80 characters");
  }

  // scheduledAt — strict ISO 8601 with timezone
  const scheduledAt = validateScheduledAt(raw["scheduledAt"]);

  // problemDescription — optional, max 1000 chars; empty string treated as absent
  let problemDescription: string | undefined = undefined;
  if (raw["problemDescription"] !== undefined && raw["problemDescription"] !== null) {
    if (typeof raw["problemDescription"] !== "string") {
      throw badRequest("problemDescription must be a string");
    }
    const trimmed = raw["problemDescription"].trim();
    if (trimmed.length > 1000) {
      throw badRequest("problemDescription must be at most 1000 characters");
    }
    problemDescription = trimmed.length > 0 ? trimmed : undefined;
  }

  // Return only the whitelisted fields (customerId, providerId, etc. are ignored)
  return {
    serviceId: rawServiceId,
    serviceAddress,
    city,
    scheduledAt,
    problemDescription,
  };
}

/** Fields extracted from a booking status update body. */
export interface UpdateBookingStatusInput {
  status: BookingStatus;
}

/**
 * Validate PATCH /api/bookings/:id/status request body.
 * Whitelists only `status`. Ignores everything else.
 */
export function validateBookingStatusBody(body: unknown): UpdateBookingStatusInput {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  if (raw["status"] === undefined) throw badRequest("status is required");
  if (typeof raw["status"] !== "string") throw badRequest("Invalid status");
  if (!BOOKING_STATUSES.includes(raw["status"] as BookingStatus)) {
    throw badRequest("Invalid status");
  }

  // Only return status — any other fields (basePrice, customerId, etc.) are silently ignored
  return { status: raw["status"] as BookingStatus };
}

/** Query parameters for listing bookings. */
export interface BookingListQuery {
  page: number;
  limit: number;
  status?: BookingStatus;
}

/**
 * Validate query parameters for GET /api/bookings/my.
 * page: positive integer, default 1, max 10000.
 * limit: positive integer, default 10, max 50.
 * status: optional, must be one of the six statuses.
 */
export function validateBookingListQuery(
  query: Record<string, unknown>
): BookingListQuery {
  // Run the injection / array-guard first (reuse parsePaginationParams for page/limit)
  const { page, limit } = parsePaginationParams(query);

  let status: BookingStatus | undefined = undefined;
  if (query["status"] !== undefined) {
    if (typeof query["status"] !== "string") {
      throw badRequest("Invalid query parameter: status");
    }
    if (!BOOKING_STATUSES.includes(query["status"] as BookingStatus)) {
      throw badRequest("Invalid status");
    }
    status = query["status"] as BookingStatus;
  }

  return { page, limit, status };
}
