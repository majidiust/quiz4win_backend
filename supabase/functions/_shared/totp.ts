/**
 * RFC 6238 TOTP + RFC 4648 Base32 helpers for Quiz4Win Edge Functions.
 *
 * Pure Web Crypto implementation — no npm/jsr dependency. Compatible with
 * Google Authenticator, 1Password, Authy, etc.
 *
 *   - Algorithm:  HMAC-SHA1
 *   - Period:     30 seconds
 *   - Digits:     6
 *   - Drift:      ±1 step accepted on verification (handles clock skew)
 *
 * Usage:
 *   const secret = generateTotpSecret();            // Base32, 32 chars
 *   const url = buildOtpAuthUrl(secret, email);     // for QR code
 *   const ok  = await verifyTotp(secret, code);     // 6-digit string
 *
 * R-01: secrets never leave the database; we accept the Base32 secret
 *       as an argument and never log it.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a 160-bit (20-byte) random Base32 secret — 32 chars, no padding. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** RFC 4648 Base32 encode (no padding). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

/** RFC 4648 Base32 decode — accepts upper/lower, strips padding and spaces. */
export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid_base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Build the otpauth://totp URI consumed by authenticator apps when scanning QR codes. */
export function buildOtpAuthUrl(secret: string, accountLabel: string, issuer = "Quiz4Win"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Compute the 6-digit TOTP code for the given Base32 secret + 30s counter step. */
async function totpAt(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  // Pack counter as big-endian 8-byte buffer.
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  // Dynamic truncation (RFC 4226 §5.3)
  const off = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[off] & 0x7f) << 24) |
    ((sig[off + 1] & 0xff) << 16) |
    ((sig[off + 2] & 0xff) << 8) |
    (sig[off + 3] & 0xff);
  const code = bin % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Verify a 6-digit code against the secret, accepting ±1 30-second step
 * to tolerate small clock drift between the user device and the server.
 */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const step of [now, now - 1, now + 1]) {
    try {
      if ((await totpAt(secret, step)) === code) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** SHA-256 hex digest helper — used to store hashed email OTPs (R-01). */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Random 6-digit numeric code for email 2FA. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % max).toString().padStart(digits, "0");
}
