import {
  OwnerProviderProfile,
  ProviderProfile,
  PublicProviderProfile,
  toOwnerProviderProfile,
  toPublicProviderProfile,
} from "../models/providerProfile.model";
import { AppError } from "../utils/AppError";
import {
  escapeRegex,
  ProviderListQuery,
  UpsertProviderProfileInput,
} from "../utils/validation";

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Get the provider profile belonging to the authenticated user.
 */
export async function getMyProfile(userId: string): Promise<OwnerProviderProfile> {
  const profile = await ProviderProfile.findOne({ user: userId });
  if (!profile) {
    throw new AppError("Provider profile not found", 404);
  }
  return toOwnerProviderProfile(profile);
}

/**
 * Upsert the provider profile for the authenticated user.
 * Returns the owner representation and whether the profile was newly created.
 */
export async function upsertMyProfile(
  userId: string,
  data: UpsertProviderProfileInput
): Promise<{ profile: OwnerProviderProfile; isCreated: boolean }> {
  const cityKey = data.city.trim().toLowerCase();
  const existing = await ProviderProfile.findOne({ user: userId });

  if (!existing) {
    try {
      const created = await ProviderProfile.create({
        ...data,
        user: userId,
        cityKey,
      });
      return {
        profile: toOwnerProviderProfile(created),
        isCreated: true,
      };
    } catch (err: any) {
      if (err && err.code === 11000) {
        // Handled race condition: retry update
        const updated = await ProviderProfile.findOneAndUpdate(
          { user: userId },
          { $set: { ...data, cityKey } },
          { new: true, runValidators: true }
        );
        if (!updated) throw new AppError("Provider profile not found", 404);
        return {
          profile: toOwnerProviderProfile(updated),
          isCreated: false,
        };
      }
      throw err;
    }
  }

  const updated = await ProviderProfile.findOneAndUpdate(
    { user: userId },
    { $set: { ...data, cityKey } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new AppError("Provider profile not found", 404);
  }

  return {
    profile: toOwnerProviderProfile(updated),
    isCreated: false,
  };
}

/**
 * Get a single public provider profile by ID.
 * Returns 404 if not found or inactive.
 */
export async function getPublicProfile(id: string): Promise<PublicProviderProfile> {
  const profile = await ProviderProfile.findOne({ _id: id, isActive: true });
  if (!profile) {
    throw new AppError("Provider not found", 404);
  }
  return toPublicProviderProfile(profile);
}

/**
 * List active public provider profiles with filters and pagination.
 */
export async function listPublicProfiles(
  filters: ProviderListQuery
): Promise<PaginatedResult<PublicProviderProfile>> {
  const query: Record<string, unknown> = { isActive: true };

  if (filters.city) {
    query.cityKey = filters.city;
  }

  if (filters.providerType) {
    query.providerType = filters.providerType;
  }

  if (filters.q) {
    const regex = new RegExp(escapeRegex(filters.q), "i");
    query.$or = [{ displayName: regex }, { description: regex }];
  }

  const { page, limit } = filters;
  const skip = (page - 1) * limit;

  const [total, profiles] = await Promise.all([
    ProviderProfile.countDocuments(query),
    ProviderProfile.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items: profiles.map(toPublicProviderProfile),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}
