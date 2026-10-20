import {
  IProviderProfileDocument,
  ProviderProfile,
} from "../models/providerProfile.model";
import {
  IServiceDocument,
  OwnerService,
  PublicService,
  Service,
  toOwnerService,
  toPublicService,
} from "../models/service.model";
import { AppError } from "../utils/AppError";
import {
  CreateServiceInput,
  escapeRegex,
  ServiceListQuery,
  UpdateServiceInput,
} from "../utils/validation";
import { PaginatedResult } from "./provider.service";

/**
 * Helper to require that the authenticated user has created a provider profile.
 */
export async function requireProviderProfile(
  userId: string
): Promise<IProviderProfileDocument> {
  const profile = await ProviderProfile.findOne({ user: userId });
  if (!profile) {
    throw new AppError("Create your provider profile before managing services", 409);
  }
  return profile;
}

/**
 * Create a new service under the authenticated provider's profile.
 */
export async function createService(
  userId: string,
  data: CreateServiceInput
): Promise<OwnerService> {
  const profile = await requireProviderProfile(userId);

  const service = await Service.create({
    ...data,
    provider: profile._id,
    isActive: data.isActive !== undefined ? data.isActive : true,
  });

  return toOwnerService(service);
}

/**
 * List all services (active and inactive) owned by the caller.
 */
export async function listMyServices(
  userId: string,
  pagination: { page: number; limit: number }
): Promise<PaginatedResult<OwnerService>> {
  const profile = await ProviderProfile.findOne({ user: userId });
  const { page, limit } = pagination;

  if (!profile) {
    return {
      items: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 1,
      },
    };
  }

  const query = { provider: profile._id };
  const skip = (page - 1) * limit;

  const [total, services] = await Promise.all([
    Service.countDocuments(query),
    Service.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items: services.map(toOwnerService),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

/**
 * Get a single service by ID.
 * Visible if service and its provider are active, OR if the requester is the owner.
 */
export async function getServiceById(
  id: string,
  requesterUserId?: string
): Promise<PublicService> {
  const service = await Service.findById(id).populate<{
    provider: IProviderProfileDocument;
  }>("provider");

  if (!service || !service.provider) {
    throw new AppError("Service not found", 404);
  }

  let isOwner = false;
  if (requesterUserId) {
    isOwner = String(service.provider.user) === requesterUserId;
  }

  if (!isOwner) {
    if (!service.isActive || !service.provider.isActive) {
      throw new AppError("Service not found", 404);
    }
  }

  return toPublicService(service);
}

/**
 * Update an existing service owned by the caller.
 */
export async function updateService(
  userId: string,
  id: string,
  data: UpdateServiceInput
): Promise<OwnerService> {
  const profile = await requireProviderProfile(userId);

  const service = await Service.findOneAndUpdate(
    { _id: id, provider: profile._id },
    { $set: data },
    { new: true, runValidators: true }
  );

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  return toOwnerService(service);
}

/**
 * Set the active status of an existing service owned by the caller.
 */
export async function setServiceStatus(
  userId: string,
  id: string,
  isActive: boolean
): Promise<OwnerService> {
  const profile = await requireProviderProfile(userId);

  const service = await Service.findOneAndUpdate(
    { _id: id, provider: profile._id },
    { $set: { isActive } },
    { new: true, runValidators: true }
  );

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  return toOwnerService(service);
}

/**
 * List public services from active providers with filters and pagination.
 */
export async function listPublicServices(
  filters: ServiceListQuery
): Promise<PaginatedResult<PublicService>> {
  const providerFilter: Record<string, unknown> = { isActive: true };
  if (filters.city) {
    providerFilter.cityKey = filters.city;
  }

  const activeProviderIds = await ProviderProfile.find(providerFilter).distinct(
    "_id"
  );

  const serviceQuery: Record<string, unknown> = {
    isActive: true,
    provider: { $in: activeProviderIds },
  };

  if (filters.category) {
    serviceQuery.category = filters.category;
  }

  if (filters.q) {
    const regex = new RegExp(escapeRegex(filters.q), "i");
    serviceQuery.$or = [{ title: regex }, { description: regex }];
  }

  const { page, limit } = filters;
  const skip = (page - 1) * limit;

  const [total, services] = await Promise.all([
    Service.countDocuments(serviceQuery),
    Service.find(serviceQuery)
      .populate("provider")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items: services.map(toPublicService),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}
