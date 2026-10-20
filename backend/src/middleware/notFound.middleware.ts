import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

/**
 * Catch-all for any request that didn't match a defined route.
 * Creates a 404 AppError and passes it to the error handler.
 */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}
