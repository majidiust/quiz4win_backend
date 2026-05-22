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
 */
export async function validateJWT(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing or invalid Authorization header" };
  }

  const supabase = getAnonClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: error?.message ?? "Unauthorized" };
  }

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
