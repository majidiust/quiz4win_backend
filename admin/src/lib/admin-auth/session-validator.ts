import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashToken } from "./tokens";

export type AdminRole = "super_admin" | "admin" | "moderator" | "finance" | "support";

export interface ValidatedAdmin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: "active" | "disabled";
  mfa_enabled: boolean;
  last_login_at: string | null;
  session_id: string;
  aal: "aal1" | "aal2";
}

/**
 * Look up an active session by its plaintext token. Returns the joined
 * admin_users row + session metadata, or null on any failure (no session,
 * expired, revoked, disabled account).
 *
 * Also touches last_used_at as a side-effect so we can prune idle sessions.
 */
export async function validateSessionToken(token: string | null): Promise<ValidatedAdmin | null> {
  if (!token) return null;
  const db = createSupabaseAdminClient();

  const tokenHash = hashToken(token);
  const { data: session } = await db
    .from("admin_sessions")
    .select("id, admin_id, aal, expires_at, revoked_at")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const { data: admin } = await db
    .from("admin_users")
    .select("id, email, name, role, status, mfa_enabled, last_login_at")
    .eq("id", session.admin_id)
    .maybeSingle();

  if (!admin) return null;
  if (admin.status !== "active") return null;

  // Best-effort last_used_at update (no need to await).
  void db
    .from("admin_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role as AdminRole,
    status: admin.status as "active" | "disabled",
    mfa_enabled: admin.mfa_enabled,
    last_login_at: admin.last_login_at,
    session_id: session.id,
    aal: session.aal as "aal1" | "aal2",
  };
}
