import mongoose, { Document, Schema, Types } from "mongoose";

/** All allowed booking statuses. */
export const BOOKING_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface IBookingDocument extends Document {
  customerId: Types.ObjectId;
  serviceId: Types.ObjectId;
  providerId: Types.ObjectId;
  serviceTitle: string;
  basePrice: number;
  serviceAddress: string;
  city: string;
  scheduledAt: Date;
  problemDescription?: string;
  status: BookingStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe serialized booking — returned to both customer and provider. */
export interface SafeBooking {
  id: string;
  customerId: string;
  serviceId: string;
  providerId: string;
  serviceTitle: string;
  basePrice: number;
  serviceAddress: string;
  city: string;
  scheduledAt: string; // ISO UTC string
  problemDescription?: string; // omitted when absent
  status: BookingStatus;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<IBookingDocument>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true,
    },
    // Snapshot of Service.title at booking creation time — never changes.
    serviceTitle: {
      type: String,
      required: true,
      trim: true,
    },
    // Snapshot of Service.basePrice at booking creation time — never changes.
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    serviceAddress: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 200,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    problemDescription: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient paginated listing
bookingSchema.index({ customerId: 1, createdAt: -1, _id: -1 });
bookingSchema.index({ providerId: 1, createdAt: -1, _id: -1 });
bookingSchema.index({ customerId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ providerId: 1, status: 1, createdAt: -1 });


/**
 * Convert a Mongoose booking document to a safe plain object.
 * Never returns raw Mongoose docs; strips _id, __v, and all sensitive fields.
 * Cross-party contact details (provider phone/address, user email) are never included.
 * serviceAddress and city are returned to both parties since the provider needs them.
 */
export function toSafeBooking(booking: IBookingDocument | any): SafeBooking {
  const doc = booking._doc || booking;
  const result: SafeBooking = {
    id: String(doc._id || booking.id),
    customerId: String(doc.customerId),
    serviceId: String(doc.serviceId),
    providerId: String(doc.providerId),
    serviceTitle: doc.serviceTitle,
    basePrice: doc.basePrice,
    serviceAddress: doc.serviceAddress,
    city: doc.city,
    scheduledAt: doc.scheduledAt instanceof Date
      ? doc.scheduledAt.toISOString()
      : new Date(doc.scheduledAt).toISOString(),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  // Omit problemDescription entirely when absent/empty
  if (doc.problemDescription) {
    result.problemDescription = doc.problemDescription;
  }
  return result;
}

export const Booking = mongoose.model<IBookingDocument>("Booking", bookingSchema);
