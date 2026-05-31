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
import { getPublicClient } from "./supabase.ts";

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
  //
  // Use getPublicClient() (not getAnonClient) so the SDK's default
  // "Authorization: Bearer <ANON_KEY>" header reaches gotrue unchanged.
  // getAnonClient(req) forwards the *user's* Bearer into global.headers,
  // which overrides the SDK's apikey slot on /auth/v1/* calls and causes
  // gotrue to return "Invalid API key" — same root cause fixed in 408cd35.
  const supabase = getPublicClient();
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

/* =========================================================================== *
 *  Admin-session token path — used by the trusted Next.js admin panel.
 *
 *  The panel issues its own session tokens (random base64url) and stores a
 *  SHA-256 hex digest in admin_sessions.session_token_hash. When the panel's
 *  server actions need to call the API (e.g. admin-liveavatar to fetch the
 *  provider's avatar/voice catalog), they forward the raw token in the
 *  X-Admin-Session-Token header. This avoids needing a Supabase user JWT —
 *  the admin panel does not log admins in via Supabase Auth.
 * =========================================================================== */

/** Hex SHA-256 of `input` using Web Crypto. */
async function sha256HexInternal(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate an X-Admin-Session-Token header against the admin_sessions table.
 * Mirrors the logic in admin/src/lib/admin-auth/session-validator.ts.
 *
 * Returns the matching admin_users row or an error string.
 */
export async function validateAdminSessionToken(
  token: string,
  allowedRoles: string[] = ["super_admin", "admin", "moderator", "finance", "support"],
): Promise<{ adminUser: Record<string, unknown> | null; error: string | null }> {
  if (!token) return { adminUser: null, error: "Missing admin session token" };

  const { getAdminClient } = await import("./supabase.ts");
  const db = getAdminClient();

  const tokenHash = await sha256HexInternal(token);
  const { data: session, error: sessErr } = await db
    .from("admin_sessions")
    .select("id, admin_id, expires_at, revoked_at")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();

  if (sessErr || !session) {
    return { adminUser: null, error: "Invalid admin session" };
  }
  if (session.revoked_at) return { adminUser: null, error: "Admin session revoked" };
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return { adminUser: null, error: "Admin session expired" };
  }

  const { data: admin, error: adminErr } = await db
    .from("admin_users")
    .select("id, role, status, name, email, mfa_enabled, last_login_at")
    .eq("id", session.admin_id)
    .maybeSingle();

  if (adminErr || !admin) return { adminUser: null, error: "Admin not found" };
  if (admin.status !== "active") {
    return { adminUser: null, error: "Forbidden — admin account is disabled" };
  }
  if (!allowedRoles.includes(admin.role as string)) {
    return { adminUser: null, error: `Forbidden — role '${admin.role}' is not permitted for this action` };
  }

  // Best-effort last_used_at update — never blocks request.
  void db
    .from("admin_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  return { adminUser: admin as Record<string, unknown>, error: null };
}

/* =========================================================================== *
 *  X-API-Key path — server-to-server admin access via long-lived keys.
 *  Companion to validateJWT(). Both paths converge in validateAdminAccess().
 * =========================================================================== */

export type AdminAccessSource = "jwt" | "api_key";

export interface AdminAccess {
  /** "jwt" if authenticated by an admin user session, "api_key" otherwise. */
  source: AdminAccessSource;
  /** Effective role for authorisation checks. */
  role: string;
  /** admin_users.id for JWT path; api_keys.created_by for API-key path. */
  actorId: string;
  /** api_keys.id when source === "api_key", else null. Useful for audit logs. */
  apiKeyId: string | null;
}

export interface AdminAccessResult {
  access: AdminAccess | null;
  /** HTTP status to return when access is null. */
  status: number;
  error: string | null;
}

/** Hex SHA-256 of `input` using the Web Crypto API (Deno-native). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-equal, constant-time comparison of two hex strings. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Best-effort client IP from common proxy headers. */
function ipFromReq(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? null;
}

/**
 * Validates an X-API-Key header (`key_id.secret` format) against api_keys.
 * On success, updates last_used_at/last_used_ip best-effort and returns the
 * key's role. On any failure, returns a generic "Invalid API key" message —
 * never leaks whether the key_id existed.
 */
async function validateApiKeyHeader(req: Request, raw: string): Promise<AdminAccessResult> {
  const url = new URL(req.url);
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    console.warn(`[auth] ${req.method} ${url.pathname} — malformed X-API-Key`);
    return { access: null, status: 401, error: "Invalid API key" };
  }
  const keyId = trimmed.slice(0, dot);
  const secret = trimmed.slice(dot + 1);

  const { getAdminClient } = await import("./supabase.ts");
  const db = getAdminClient();
  const { data, error } = await db
    .from("api_keys")
    .select("id, secret_hash, role, allowed_domains, expires_at, revoked_at, created_by")
    .eq("key_id", keyId)
    .maybeSingle();

  if (error || !data) {
    console.warn(`[auth] ${req.method} ${url.pathname} — api key lookup miss key_id=${keyId}`);
    return { access: null, status: 401, error: "Invalid API key" };
  }

  const row = data as {
    id: string; secret_hash: string; role: string; allowed_domains: string[] | null;
    expires_at: string | null; revoked_at: string | null; created_by: string;
  };

  const candidate = await sha256Hex(secret);
  if (!constantTimeEqual(candidate, row.secret_hash)) {
    console.warn(`[auth] ${req.method} ${url.pathname} — api key secret mismatch key_id=${keyId}`);
    return { access: null, status: 401, error: "Invalid API key" };
  }

  if (row.revoked_at) {
    return { access: null, status: 401, error: "API key has been revoked" };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { access: null, status: 401, error: "API key has expired" };
  }

  const allowed = (row.allowed_domains ?? []).filter(Boolean);
  if (allowed.length > 0) {
    const origin = (req.headers.get("origin") ?? "").toLowerCase();
    const ok = origin && allowed.some((d) => d.toLowerCase() === origin);
    if (!ok) {
      console.warn(`[auth] ${req.method} ${url.pathname} — api key origin '${origin}' not allowed for key_id=${keyId}`);
      return { access: null, status: 403, error: "Origin not allowed for this API key" };
    }
  }

  // Best-effort usage stamp — never blocks request on failure.
  db.from("api_keys")
    .update({ last_used_at: new Date().toISOString(), last_used_ip: ipFromReq(req) })
    .eq("id", row.id)
    .then(({ error: uErr }) => {
      if (uErr) console.warn(`[auth] api_keys last_used update failed: ${uErr.message}`);
    });

  console.log(`[auth] ${req.method} ${url.pathname} — api key OK key_id=${keyId} role=${row.role}`);
  return {
    access: { source: "api_key", role: row.role, actorId: row.created_by, apiKeyId: row.id },
    status: 200,
    error: null,
  };
}

/**
 * Unified admin-auth gate: accepts either a Bearer JWT (admin user session)
 * or an X-API-Key header. Enforces the supplied role allow-list against the
 * resolved role.
 *
 * Usage:
 *   const auth = await validateAdminAccess(req, ["super_admin", "admin"]);
 *   if (!auth.access) return errorResponse(auth.error!, auth.status);
 */
export async function validateAdminAccess(
  req: Request,
  allowedRoles: string[] = ["super_admin", "admin", "moderator", "finance", "support"],
): Promise<AdminAccessResult> {
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) {
    const res = await validateApiKeyHeader(req, apiKeyHeader);
    if (!res.access) return res;
    if (!allowedRoles.includes(res.access.role)) {
      return { access: null, status: 403, error: `Forbidden — role '${res.access.role}' is not permitted for this action` };
    }
    return res;
  }

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return { access: null, status: 401, error: authErr ?? "Unauthorized" };
  const { adminUser, error: roleErr } = await requireAdminRole(user.id, allowedRoles);
  if (roleErr || !adminUser) return { access: null, status: 403, error: roleErr ?? "Forbidden" };
  return {
    access: { source: "jwt", role: adminUser.role as string, actorId: user.id, apiKeyId: null },
    status: 200,
    error: null,
  };
}
