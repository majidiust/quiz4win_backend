"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

const ADMIN_ROLES = ["super_admin", "admin", "moderator", "finance", "support"] as const;

/* ------------------------------------------------------------------ */
/* Invite new admin                                                     */
/* ------------------------------------------------------------------ */
const InviteSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ADMIN_ROLES),
});

export async function inviteAdmin(input: z.infer<typeof InviteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { email, name, role } = parsed.data;
  const db = createSupabaseAdminClient();

  // Check for existing admin
  const { data: existing } = await db.from("admin_users").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, message: "An admin with this email already exists" };

  // Invite via Supabase Auth
  const { data: authUser, error: inviteErr } = await db.auth.admin.inviteUserByEmail(email, {
    data: { name, role, is_admin: true },
  });
  if (inviteErr || !authUser.user) return { ok: false, message: inviteErr?.message ?? "Failed to send invite" };

  // Create admin_users row
  const { error } = await db.from("admin_users").insert({
    id: authUser.user.id,
    email,
    name,
    role,
    status: "active",
    mfa_enabled: false,
    invited_by: admin.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Admin created in auth but DB record failed: " + error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "admin_invited",
    target_type: "admin_user",
    target_id: authUser.user.id,
    details: { email, role },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/admins");
  return { ok: true, message: `Invite sent to ${email}` };
}

/* ------------------------------------------------------------------ */
/* Edit admin (role, status)                                            */
/* ------------------------------------------------------------------ */
const EditAdminSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

export async function updateAdminUser(input: z.infer<typeof EditAdminSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const parsed = EditAdminSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { id, ...updates } = parsed.data;
  if (id === admin.id && updates.status === "disabled") {
    return { ok: false, message: "You cannot disable your own account" };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("admin_users")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: "Failed to update admin" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "admin_updated",
    target_type: "admin_user",
    target_id: id,
    details: updates,
    created_at: new Date().toISOString(),
  });

  revalidatePath("/admins");
  return { ok: true, message: "Admin updated" };
}
