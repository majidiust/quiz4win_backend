import "server-only";
import { redirect } from "next/navigation";
import { readSessionCookie, validateSessionToken, type ValidatedAdmin } from "./admin-auth";

export type AdminRole = "super_admin" | "admin" | "moderator" | "finance" | "support";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: "active" | "disabled";
  mfa_enabled: boolean;
  last_login_at: string | null;
}

function toAdminUser(v: ValidatedAdmin): AdminUser {
  return {
    id: v.id,
    email: v.email,
    name: v.name,
    role: v.role,
    status: v.status,
    mfa_enabled: v.mfa_enabled,
    last_login_at: v.last_login_at,
  };
}

/**
 * Server-only — returns the current authenticated admin or redirects to /login.
 *
 * The native admin-auth subsystem (admin/src/lib/admin-auth) replaces the
 * previous Supabase Auth based identity. We read the q4w_admin_session
 * cookie, look up the matching row in admin_sessions (joined with
 * admin_users) and enforce status + role policy here.
 */
export async function requireAdmin(allowedRoles?: AdminRole[]): Promise<AdminUser> {
  const token = await readSessionCookie();
  const admin = await validateSessionToken(token);
  if (!admin) redirect("/login");
  if (allowedRoles && !allowedRoles.includes(admin.role)) {
    redirect("/dashboard?error=forbidden");
  }
  return toAdminUser(admin);
}

/** Server-only — returns the current admin without redirecting; useful in layouts. */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const token = await readSessionCookie();
  const admin = await validateSessionToken(token);
  return admin ? toAdminUser(admin) : null;
}

/** Roles permitted to access a given route prefix. */
export const ROUTE_ROLES: Record<string, AdminRole[]> = {
  "/finance": ["super_admin", "admin", "finance"],
  "/kyc": ["super_admin", "admin", "support"],
  "/support": ["super_admin", "admin", "support"],
  "/users": ["super_admin", "admin", "support"],
  "/games": ["super_admin", "admin", "moderator"],
  "/shows": ["super_admin", "admin", "moderator"],
  "/questions": ["super_admin", "admin", "moderator"],
  "/vouchers": ["super_admin", "admin"],
  "/notifications": ["super_admin", "admin"],
  "/referrals": ["super_admin", "admin"],
  "/sounds": ["super_admin", "admin"],
  "/config": ["super_admin", "admin"],
  "/admins": ["super_admin"],
  "/api-keys": ["super_admin"],
  "/audit": ["super_admin"],
};
