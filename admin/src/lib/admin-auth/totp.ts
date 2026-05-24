import "server-only";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Quiz4Win Admin";

/** Generate a fresh TOTP secret (160-bit base32) and an otpauth:// URI. */
export function newSecret(adminEmail: string): { secret: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: adminEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

/**
 * Verify a 6-digit TOTP code against the stored base32 secret.
 *
 * `window` allows ±N×30s clock skew (default 1 = accept previous, current,
 * next code) which is the industry norm for TOTP.
 */
export function verifyCode(secret: string, code: string, window = 1): boolean {
  if (!secret || !code) return false;
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== 6) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: cleaned, window });
    return delta !== null;
  } catch {
    return false;
  }
}

/** Render an otpauth:// URI as a base64 data-URL PNG QR code. */
export async function renderQrCode(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 240 });
}
