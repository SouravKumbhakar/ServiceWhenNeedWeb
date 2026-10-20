import { NextFunction, Request, Response } from "express";
import {
  getMyProfile,
  listPublicProfiles,
  getPublicProfile,
  upsertMyProfile,
} from "../services/provider.service";
import { AppError } from "../utils/AppError";
import {
  validateObjectIdParam,
  validateProviderListQuery,
  validateProviderProfileBody,
} from "../utils/validation";

/**
 * GET /api/providers/me - Get own profile (provider only).
 */
export async function getMyProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const profile = await getMyProfile(req.user.id);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: {
        provider: profile,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/providers/me - Create (201) or replace (200) own profile.
 */
export async function upsertMyProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const input = validateProviderProfileBody(req.body);
    const { profile, isCreated } = await upsertMyProfile(req.user.id, input);

    res.set("Cache-Control", "no-store");
    res.status(isCreated ? 201 : 200).json({
      success: true,
      data: {
        provider: profile,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/providers/:id - Get a public provider profile by ID.
 */
export async function getPublicProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = validateObjectIdParam(req.params.id, "provider id");
    const profile = await getPublicProfile(id);

    res.status(200).json({
      success: true,
      data: {
        provider: profile,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/providers - List public provider profiles.
 */
export async function listPublicProfilesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = validateProviderListQuery(
      req.query as Record<string, unknown>
    );
    const result = await listPublicProfiles(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
