import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { SafeUser, toSafeUser, User } from "../models/user.model";
import { AppError } from "../utils/AppError";
import { LoginInput, RegisterInput } from "../utils/validation";

// Pre-computed dummy hash to prevent timing attacks when email is not found
const DUMMY_HASH = bcrypt.hashSync("dummy-password", env.BCRYPT_SALT_ROUNDS);

export interface LoginResult {
  token: string;
  user: SafeUser;
}

/**
 * Register a new user. Hashes the password and saves the user to the database.
 * Throws 409 if the email is already registered.
 */
export async function registerUser(input: RegisterInput): Promise<SafeUser> {
  // Pre-check for duplicate email
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw new AppError("Email is already registered", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    });
    return toSafeUser(user);
  } catch (error: any) {
    if (error && error.code === 11000) {
      throw new AppError("Email is already registered", 409);
    }
    throw error;
  }
}

/**
 * Log in an existing user.
 * Prevents timing attacks when email does not exist.
 * Checks password before checking isActive status.
 */
export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const user = await User.findOne({ email: input.email }).select("+passwordHash");

  if (!user) {
    // Run comparison against dummy hash to maintain constant time response
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new AppError("Invalid email or password", 401);
  }

  const isMatch = await bcrypt.compare(input.password, user.passwordHash);
  if (!isMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  // Account status check only after valid password verification
  if (!user.isActive) {
    throw new AppError("Account is disabled", 403);
  }

  const signOptions: SignOptions = {
    subject: String(user._id),
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    algorithm: "HS256",
  };

  const token = jwt.sign({ role: user.role }, env.JWT_SECRET, signOptions);

  return {
    token,
    user: toSafeUser(user),
  };
}
