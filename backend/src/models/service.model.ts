import mongoose, { Document, Schema, Types } from "mongoose";
import {
  PublicProviderSummary,
  toPublicProviderSummary,
} from "./providerProfile.model";

export const SERVICE_CATEGORIES = [
  "ac",
  "refrigerator",
  "fan",
  "computer",
  "mobile",
  "other",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export interface IServiceDocument extends Document {
  provider: Types.ObjectId;
  title: string;
  description: string;
  category: ServiceCategory;
  basePrice: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerService {
  id: string;
  providerId: string;
  title: string;
  description: string;
  category: ServiceCategory;
  basePrice: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicService {
  id: string;
  title: string;
  description: string;
  category: ServiceCategory;
  basePrice: number;
  createdAt: Date;
  provider: PublicProviderSummary;
}

const serviceSchema = new Schema<IServiceDocument>(
  {
    provider: {
      type: Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    category: {
      type: String,
      enum: SERVICE_CATEGORIES,
      required: true,
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0,
      max: 10000000,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
serviceSchema.index({ provider: 1, createdAt: -1 });
serviceSchema.index({ isActive: 1, category: 1, createdAt: -1 });

export function toOwnerService(service: IServiceDocument | any): OwnerService {
  const doc = service._doc || service;
  return {
    id: String(doc._id || service.id),
    providerId: String(doc.provider?._id || doc.provider || ""),
    title: doc.title,
    description: doc.description,
    category: doc.category,
    basePrice: doc.basePrice,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function toPublicService(service: IServiceDocument | any): PublicService {
  const doc = service._doc || service;
  return {
    id: String(doc._id || service.id),
    title: doc.title,
    description: doc.description,
    category: doc.category,
    basePrice: doc.basePrice,
    createdAt: doc.createdAt,
    provider: toPublicProviderSummary(doc.provider),
  };
}

export const Service = mongoose.model<IServiceDocument>("Service", serviceSchema);
