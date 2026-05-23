"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

/* ------------------------------------------------------------------ */
/* Update own display name                                              */
/* ------------------------------------------------------------------ */
const NameSchema = z.object({ name: z.string().trim().min(1).max(200) });

export async function updateOwnProfile(input: z.infer<typeof NameSchema>): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = NameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("admin_users")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", admin.id);
  if (error) return { ok: false, message: "Failed to update profile" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "profile_updated",
    target_type: "admin_user",
    target_id: admin.id,
    details: { name: parsed.data.name },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/profile");
  return { ok: true, message: "Profile updated" };
}

/* ------------------------------------------------------------------ */
/* Change own password                                                  */
/* ------------------------------------------------------------------ */
const PasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

export async function changeOwnPassword(input: z.infer<typeof PasswordSchema>): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = PasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "New password must be at least 8 characters" };

  // Re-authenticate by signing in with the current password (no session side-effects
  // because we use a fresh server client and immediately discard it).
  const auth = await createSupabaseServerClient();
  const { error: signInErr } = await auth.auth.signInWithPassword({
    email: admin.email,
    password: parsed.data.current_password,
  });
  if (signInErr) return { ok: false, message: "Current password is incorrect" };

  const db = createSupabaseAdminClient();
  const { error: updateErr } = await db.auth.admin.updateUserById(admin.id, {
    password: parsed.data.new_password,
  });
  if (updateErr) return { ok: false, message: "Failed to update password" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "password_changed",
    target_type: "admin_user",
    target_id: admin.id,
    created_at: new Date().toISOString(),
  });

  return { ok: true, message: "Password changed" };
}

/* ------------------------------------------------------------------ */
/* MFA enabled flag — called after client-side enroll/verify or unenroll */
/* ------------------------------------------------------------------ */
const MfaFlagSchema = z.object({ enabled: z.boolean() });

export async function setOwnMfaEnabled(input: z.infer<typeof MfaFlagSchema>): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = MfaFlagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("admin_users")
    .update({ mfa_enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
    .eq("id", admin.id);
  if (error) return { ok: false, message: "Failed to update MFA status" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: parsed.data.enabled ? "mfa_enabled" : "mfa_disabled",
    target_type: "admin_user",
    target_id: admin.id,
    created_at: new Date().toISOString(),
  });

  revalidatePath("/profile");
  revalidatePath("/profile/mfa");
  return { ok: true, message: parsed.data.enabled ? "MFA enabled" : "MFA disabled" };
}
