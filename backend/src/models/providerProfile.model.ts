import mongoose, { Document, Schema, Types } from "mongoose";

export const ProviderType = {
  INDIVIDUAL: "individual",
  COMPANY: "company",
} as const;

export type ProviderType = (typeof ProviderType)[keyof typeof ProviderType];

export const PROVIDER_TYPES: ProviderType[] = [
  ProviderType.INDIVIDUAL,
  ProviderType.COMPANY,
];

export interface IProviderProfileDocument extends Document {
  user: Types.ObjectId;
  providerType: ProviderType;
  displayName: string;
  phone: string;
  address: string;
  city: string;
  cityKey: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerProviderProfile {
  id: string;
  providerType: ProviderType;
  displayName: string;
  phone: string;
  address: string;
  city: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicProviderProfile {
  id: string;
  providerType: ProviderType;
  displayName: string;
  city: string;
  description?: string;
  createdAt: Date;
}

export interface PublicProviderSummary {
  id: string;
  providerType: ProviderType;
  displayName: string;
  city: string;
}

const providerProfileSchema = new Schema<IProviderProfileDocument>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    providerType: {
      type: String,
      enum: PROVIDER_TYPES,
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
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
    cityKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
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

providerProfileSchema.index({ isActive: 1, cityKey: 1, createdAt: -1 });

providerProfileSchema.pre("validate", function () {
  if (this.city) {
    this.cityKey = this.city.trim().toLowerCase();
  }
});

export function toOwnerProviderProfile(
  profile: IProviderProfileDocument | any
): OwnerProviderProfile {
  const doc = profile._doc || profile;
  return {
    id: String(doc._id || profile.id),
    providerType: doc.providerType,
    displayName: doc.displayName,
    phone: doc.phone,
    address: doc.address,
    city: doc.city,
    description: doc.description || undefined,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function toPublicProviderProfile(
  profile: IProviderProfileDocument | any
): PublicProviderProfile {
  const doc = profile._doc || profile;
  return {
    id: String(doc._id || profile.id),
    providerType: doc.providerType,
    displayName: doc.displayName,
    city: doc.city,
    description: doc.description || undefined,
    createdAt: doc.createdAt,
  };
}

export function toPublicProviderSummary(
  profile: IProviderProfileDocument | any
): PublicProviderSummary {
  const doc = profile._doc || profile;
  return {
    id: String(doc._id || profile.id),
    providerType: doc.providerType,
    displayName: doc.displayName,
    city: doc.city,
  };
}

export const ProviderProfile = mongoose.model<IProviderProfileDocument>(
  "ProviderProfile",
  providerProfileSchema
);
