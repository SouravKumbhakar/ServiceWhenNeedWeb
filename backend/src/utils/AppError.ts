/**
 * A structured operational error that carries an HTTP status code.
 * Use this instead of plain Error so the error handler can distinguish
 * expected errors (wrong input, not found) from unexpected crashes.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  /** True means the error was intentional and its message is safe to show clients. */
  public readonly isOperational = true;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    // Restore the prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
