import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Token primitives for the native admin-auth subsystem.
 *
 * The server only ever persists a SHA-256 hash of every issued token. The
 * raw token lives exclusively in:
 *   • the admin browser cookie (session/refresh tokens), or
 *   • the URL of an email link (password reset / invite / MFA challenge).
 *
 * A leaked database row therefore cannot be used to impersonate an admin.
 */

/** 32 bytes = 256 bits of entropy, URL-safe base64. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Stable SHA-256 hex digest used as the lookup key in the *_hash columns. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time string comparison. Used when comparing user-supplied
 * recovery codes against stored ones to avoid timing leaks.
 */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Generate ten URL-safe one-time MFA recovery codes (10 chars each, grouped
 * 5-5 with a dash for readability — eg "AB12C-DE34F").
 */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(10);
    let code = "";
    for (let j = 0; j < 10; j++) {
      code += alphabet[raw[j] % alphabet.length];
      if (j === 4) code += "-";
    }
    codes.push(code);
  }
  return codes;
}
