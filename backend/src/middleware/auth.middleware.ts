import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload, TokenExpiredError } from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env";
import { User, UserRole } from "../models/user.model";
import { AppError } from "../utils/AppError";

const VALID_ROLES = new Set<string>([
  UserRole.CUSTOMER,
  UserRole.PROVIDER,
  UserRole.ADMIN,
]);

/**
 * Common helper to verify authorization header and resolve active user.
 */
async function resolveAuthUser(authHeader: string): Promise<{ id: string; role: UserRole }> {
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    throw new AppError("Authentication required", 401);
  }

  const token = parts[1];

  let payload: JwtPayload | string;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new AppError("Token expired", 401);
    }
    throw new AppError("Invalid token", 401);
  }

  if (typeof payload === "string" || !payload || typeof payload.sub !== "string") {
    throw new AppError("Invalid token", 401);
  }

  if (!mongoose.isValidObjectId(payload.sub)) {
    throw new AppError("Invalid token", 401);
  }

  if (typeof payload.role !== "string" || !VALID_ROLES.has(payload.role)) {
    throw new AppError("Invalid token", 401);
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new AppError("Invalid or inactive account", 401);
  }

  // Database role is the source of truth
  return {
    id: String(user._id),
    role: user.role,
  };
}

/**
 * Authentication middleware that verifies JWT tokens from Authorization header.
 * Attaches req.user { id, role } based on real database state.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next(new AppError("Authentication required", 401));
  }

  try {
    req.user = await resolveAuthUser(authHeader);
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Optional authentication middleware.
 * If Authorization header is omitted, proceeds anonymously without error.
 * If Authorization header is present, it must be valid or returns 401.
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }

  try {
    req.user = await resolveAuthUser(authHeader);
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Role-based authorization middleware.
 */
export function authorizeRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError("Authentication required", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError("Insufficient permissions", 403));
    }

    return next();
  };
}
