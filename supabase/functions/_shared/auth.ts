/**
 * JWT validation helper for Quiz4Win Edge Functions.
 *
 * Usage (R-03 compliant):
 *   const { user, error } = await validateJWT(req);
 *   if (error) return errorResponse(error, 401);
 *
 * For admin endpoints, also call `requireAdminRole(user)` after validation.
 */

import type { User } from "@supabase/supabase-js";
import { getAnonClient } from "./supabase.ts";

export interface AuthResult {
  user: User | null;
  error: string | null;
}

/**
 * Validates the Bearer token in the Authorization header.
 * Returns the authenticated Supabase User or an error string.
 *
 * Rule R-03: Every Edge Function that writes to the DB MUST call this
 * before any DB operation.
 *
 * R-01 note: the raw token is never logged. We log only its presence,
 * length, prefix (first 12 chars are fine — JWT header is public) and
 * the path that triggered the check.
 */
export async function validateJWT(req: Request): Promise<AuthResult> {
  const url = new URL(req.url);
  const authHeader = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");

  if (!authHeader) {
    console.warn(
      `[auth] ${req.method} ${url.pathname} — no Authorization header (apikey_present=${!!apikey} origin=${req.headers.get("origin") ?? "-"})`,
    );
    return { user: null, error: "Missing or invalid Authorization header" };
  }
  if (!authHeader.startsWith("Bearer ")) {
    console.warn(
      `[auth] ${req.method} ${url.pathname} — Authorization header not Bearer (prefix='${authHeader.slice(0, 10)}…')`,
    );
    return { user: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  console.log(
    `[auth] ${req.method} ${url.pathname} — Bearer received len=${token.length} prefix=${token.slice(0, 12)}… apikey_present=${!!apikey}`,
  );

  // IMPORTANT: pass the JWT explicitly. Calling getUser() with no argument
  // makes the SDK read from its internal session, which is empty in an
  // Edge Function context (persistSession: false) — so it would always
  // return AuthSessionMissingError regardless of the forwarded header.
  const supabase = getAnonClient(req);
  const startedAt = Date.now();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  const elapsed = Date.now() - startedAt;

  if (error || !user) {
    console.warn(
      `[auth] ${req.method} ${url.pathname} — supabase.auth.getUser failed in ${elapsed}ms: ${error?.message ?? "no user"}`,
    );
    return { user: null, error: error?.message ?? "Unauthorized" };
  }

  console.log(
    `[auth] ${req.method} ${url.pathname} — OK user=${user.id} role=${user.role ?? "-"} elapsed_ms=${elapsed}`,
  );
  return { user, error: null };
}

/**
 * Checks that the validated user exists in `admin_users` and has an
 * acceptable role. Returns the admin row or an error.
 *
 * @param userId - from the validated JWT (never trust a body field)
 * @param allowedRoles - roles permitted for this endpoint; defaults to all
 */
export async function requireAdminRole(
  userId: string,
  allowedRoles: string[] = [
    "super_admin",
    "admin",
    "moderator",
    "finance",
    "support",
  ],
): Promise<{ adminUser: Record<string, unknown> | null; error: string | null }> {
  const { getAdminClient } = await import("./supabase.ts");
  const adminSupabase = getAdminClient();

  const { data, error } = await adminSupabase
    .from("admin_users")
    .select("id, role, status, name, email, mfa_enabled, last_login_at")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return { adminUser: null, error: "Forbidden — not an admin account" };
  }

  if (data.status !== "active") {
    return { adminUser: null, error: "Forbidden — admin account is disabled" };
  }

  if (!allowedRoles.includes(data.role as string)) {
    return {
      adminUser: null,
      error: `Forbidden — role '${data.role}' is not permitted for this action`,
    };
  }

  return { adminUser: data as Record<string, unknown>, error: null };
}
