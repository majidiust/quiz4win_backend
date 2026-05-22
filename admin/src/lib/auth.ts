import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "./supabase/server";

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

const ADMIN_SELECT = "id, email, name, role, status, mfa_enabled, last_login_at";

/**
 * Server-only — returns the current authenticated admin or redirects to /login.
 * The admin_users table is keyed by email (it has no FK to auth.users), so we
 * match the Supabase auth email against admin_users.email. RLS is bypassed via
 * the service role because admin_users RLS policies aren't yet authored (R-04).
 */
export async function requireAdmin(allowedRoles?: AdminRole[]): Promise<AdminUser> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const admin = createSupabaseAdminClient();
  const { data: adminUser, error } = await admin
    .from("admin_users")
    .select(ADMIN_SELECT)
    .eq("email", user.email)
    .maybeSingle();

  if (error || !adminUser) redirect("/login?error=not_admin");
  if (adminUser.status !== "active") redirect("/login?error=account_disabled");
  if (allowedRoles && !allowedRoles.includes(adminUser.role as AdminRole)) {
    redirect("/dashboard?error=forbidden");
  }

  return adminUser as AdminUser;
}

/** Server-only — returns the current admin without redirecting; useful in layouts. */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("admin_users")
    .select(ADMIN_SELECT)
    .eq("email", user.email)
    .maybeSingle();

  return data && data.status === "active" ? (data as AdminUser) : null;
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
  "/config": ["super_admin", "admin"],
  "/admins": ["super_admin"],
  "/audit": ["super_admin"],
};
