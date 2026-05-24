import "server-only";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

/** Hash a plaintext password with bcrypt cost 12. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/** Constant-time verification of a plaintext password against a stored hash. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Validate password strength. The admin panel enforces a stricter policy
 * than the customer-facing app because admins control finance-sensitive
 * operations.
 *
 *   ≥12 chars · ≥1 lowercase · ≥1 uppercase · ≥1 digit · ≥1 symbol
 */
export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < 12) return "Password must be at least 12 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a digit";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must contain a symbol";
  return null;
}
