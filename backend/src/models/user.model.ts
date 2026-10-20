import mongoose, { Document, Schema } from "mongoose";

/** The allowed roles in the system. */
export const UserRole = {
  CUSTOMER: "customer",
  PROVIDER: "provider",
  ADMIN: "admin",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

const ALL_ROLES: UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.PROVIDER,
  UserRole.ADMIN,
];

/** Shape of the raw Mongoose document (passwordHash included). */
export interface IUserDocument extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe public representation — no password, no internal fields. */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format"],
    },
    // select: false means passwordHash is NEVER returned in queries unless
    // explicitly requested with .select("+passwordHash")
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ALL_ROLES,
      default: UserRole.CUSTOMER,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt automatically
  }
);

/**
 * Convert a Mongoose user document to a safe plain object
 * that can be sent to the client. Strips _id, __v, and passwordHash.
 */
export function toSafeUser(user: IUserDocument): SafeUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const User = mongoose.model<IUserDocument>("User", userSchema);
