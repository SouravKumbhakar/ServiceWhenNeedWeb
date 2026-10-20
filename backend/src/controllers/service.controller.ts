import { NextFunction, Request, Response } from "express";
import {
  createService,
  getServiceById,
  listMyServices,
  listPublicServices,
  setServiceStatus,
  updateService,
} from "../services/catalog.service";
import { AppError } from "../utils/AppError";
import {
  parsePaginationParams,
  validateCreateServiceBody,
  validateObjectIdParam,
  validateServiceListQuery,
  validateServiceStatusBody,
  validateUpdateServiceBody,
} from "../utils/validation";

/**
 * POST /api/services - Create a service under the caller's profile.
 */
export async function createServiceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const input = validateCreateServiceBody(req.body);
    const service = await createService(req.user.id, input);

    res.set("Cache-Control", "no-store");
    res.status(201).json({
      success: true,
      data: {
        service,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/services/my - Get caller's services (active and inactive).
 */
export async function listMyServicesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const pagination = parsePaginationParams(
      req.query as Record<string, unknown>
    );
    const result = await listMyServices(req.user.id, pagination);

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
 * GET /api/services/:id - Get a service by ID (public, optional auth).
 */
export async function getServiceByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = validateObjectIdParam(req.params.id, "service id");
    const service = await getServiceById(id, req.user?.id);

    res.status(200).json({
      success: true,
      data: {
        service,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/services/:id - Update an existing service (owner only).
 */
export async function updateServiceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = validateObjectIdParam(req.params.id, "service id");
    const input = validateUpdateServiceBody(req.body);
    const service = await updateService(req.user.id, id, input);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: {
        service,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/services/:id/status - Toggle service status (owner only).
 */
export async function setServiceStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = validateObjectIdParam(req.params.id, "service id");
    const { isActive } = validateServiceStatusBody(req.body);
    const service = await setServiceStatus(req.user.id, id, isActive);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: {
        service,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/services - List public active services.
 */
export async function listPublicServicesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = validateServiceListQuery(
      req.query as Record<string, unknown>
    );
    const result = await listPublicServices(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
