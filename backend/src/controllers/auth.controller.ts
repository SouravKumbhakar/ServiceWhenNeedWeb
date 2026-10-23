import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { toSafeUser, User } from "../models/user.model";
import { loginUser, registerUser } from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { validateLoginBody, validateRegisterBody } from "../utils/validation";

/**
 * Handle user registration (customer or provider).
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = validateRegisterBody(req.body);
    const user = await registerUser(input);

    res.set("Cache-Control", "no-store");
    res.status(201).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle user login. Returns signed JWT and safe user profile.
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = validateLoginBody(req.body);
    const result = await loginUser(input);

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: {
        token: result.token,
        tokenType: "Bearer",
        expiresIn: env.JWT_EXPIRES_IN,
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get profile of the currently authenticated user.
 */
export async function me(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError("Authentication required", 401);
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.isActive) {
      throw new AppError("Invalid or inactive account", 401);
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      data: {
        user: toSafeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
}
