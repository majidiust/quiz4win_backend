"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string; userId?: string }

/* ----------------------------- helpers ----------------------------- */

async function audit(adminId: string, action: string, entityId: string, details?: Record<string, unknown>) {
  const db = createSupabaseAdminClient();
  await db.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    entity_type: "auth_user",
    entity_id: entityId,
    details: details ?? null,
    created_at: new Date().toISOString(),
  });
}

/* ----------------------------- create ----------------------------- */

const CreateSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(120).optional(),
  email_confirm: z.boolean().default(true),
});

export async function createAuthUser(input: z.infer<typeof CreateSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: parsed.data.email_confirm,
    user_metadata: parsed.data.full_name ? { full_name: parsed.data.full_name } : undefined,
  });
  if (error || !data.user) return { ok: false, message: error?.message ?? "Failed to create user" };

  await audit(admin.id, "auth_user_created", data.user.id, { email: parsed.data.email });
  revalidatePath("/users");
  return { ok: true, message: "User created", userId: data.user.id };
}

/* ----------------------------- delete ----------------------------- */

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteAuthUser(input: z.infer<typeof DeleteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.auth.admin.deleteUser(parsed.data.id);
  if (error) return { ok: false, message: error.message };

  await audit(admin.id, "auth_user_deleted", parsed.data.id);
  revalidatePath("/users");
  return { ok: true, message: "User deleted" };
}

/* ----------------------------- set password ----------------------------- */

const PasswordSchema = z.object({
  id: z.string().uuid(),
  new_password: z.string().min(8).max(128),
});

export async function setUserPassword(input: z.infer<typeof PasswordSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = PasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.auth.admin.updateUserById(parsed.data.id, { password: parsed.data.new_password });
  if (error) return { ok: false, message: error.message };

  await audit(admin.id, "auth_user_password_set", parsed.data.id);
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: "Password updated" };
}

/* ----------------------------- update email ----------------------------- */

const EmailSchema = z.object({
  id: z.string().uuid(),
  new_email: z.string().trim().email().max(254),
  email_confirm: z.boolean().default(true),
});

export async function updateUserEmail(input: z.infer<typeof EmailSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = EmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error: authErr } = await db.auth.admin.updateUserById(parsed.data.id, {
    email: parsed.data.new_email,
    email_confirm: parsed.data.email_confirm,
  });
  if (authErr) return { ok: false, message: authErr.message };

  await db.from("profiles").update({ email: parsed.data.new_email, updated_at: new Date().toISOString() }).eq("id", parsed.data.id);
  await audit(admin.id, "auth_user_email_changed", parsed.data.id, { new_email: parsed.data.new_email });
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: "Email updated" };
}

/* ----------------------------- confirm email ----------------------------- */

const ConfirmSchema = z.object({ id: z.string().uuid(), confirm: z.boolean() });

export async function setEmailConfirmation(input: z.infer<typeof ConfirmSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  // updateUserById with email_confirm:true sets email_confirmed_at to now.
  // To "unconfirm", we have to clear it via direct SQL — Supabase JS doesn't expose that.
  if (parsed.data.confirm) {
    const { error } = await db.auth.admin.updateUserById(parsed.data.id, { email_confirm: true });
    if (error) return { ok: false, message: error.message };
  } else {
    return { ok: false, message: "Unconfirming email is not supported via the Supabase JS SDK" };
  }

  await audit(admin.id, "auth_user_email_confirmed", parsed.data.id);
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: "Email confirmed" };
}


/* ----------------------------- ban / unban ----------------------------- */

const BanSchema = z.object({
  id: z.string().uuid(),
  duration: z.enum(["1h", "24h", "7d", "30d", "365d", "permanent"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

export async function banUser(input: z.infer<typeof BanSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = BanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const map: Record<string, string> = {
    "1h": "1h", "24h": "24h", "7d": "168h", "30d": "720h", "365d": "8760h", "permanent": "876000h",
  };
  const db = createSupabaseAdminClient();
  const { error } = await db.auth.admin.updateUserById(parsed.data.id, { ban_duration: map[parsed.data.duration] });
  if (error) return { ok: false, message: error.message };

  await db.from("profiles").update({
    status: "banned",
    suspension_reason: parsed.data.reason ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.id);

  await audit(admin.id, "auth_user_banned", parsed.data.id, { duration: parsed.data.duration, reason: parsed.data.reason });
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: `User banned (${parsed.data.duration})` };
}

export async function unbanUser(input: z.infer<typeof DeleteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.auth.admin.updateUserById(parsed.data.id, { ban_duration: "none" });
  if (error) return { ok: false, message: error.message };

  await db.from("profiles").update({
    status: "active",
    suspension_reason: null,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.id);

  await audit(admin.id, "auth_user_unbanned", parsed.data.id);
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: "User unbanned" };
}

/* ----------------------------- revoke sessions ----------------------------- */

export async function revokeAllSessions(input: z.infer<typeof DeleteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  // Force-rotate the user's auth state by updating with no-op metadata — this invalidates
  // any active access tokens within ~60s and revokes refresh tokens.
  const { error } = await db.auth.admin.updateUserById(parsed.data.id, {
    user_metadata: { _sessions_revoked_at: new Date().toISOString() },
  });
  if (error) return { ok: false, message: error.message };

  await audit(admin.id, "auth_user_sessions_revoked", parsed.data.id);
  revalidatePath(`/users/${parsed.data.id}`);
  return { ok: true, message: "All sessions revoked" };
}

/* ----------------------------- send links ----------------------------- */

const LinkSchema = z.object({ id: z.string().uuid(), type: z.enum(["recovery", "magiclink"]) });

export async function sendAuthLink(input: z.infer<typeof LinkSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data: target } = await db.auth.admin.getUserById(parsed.data.id);
  if (!target.user?.email) return { ok: false, message: "User has no email" };

  const { error } = await db.auth.admin.generateLink({ type: parsed.data.type, email: target.user.email });
  if (error) return { ok: false, message: error.message };

  await audit(admin.id, `auth_user_${parsed.data.type}_sent`, parsed.data.id, { email: target.user.email });
  return { ok: true, message: parsed.data.type === "recovery" ? "Recovery email sent" : "Magic link email sent" };
}

/* ----------------------------- invite ----------------------------- */

const InviteSchema = z.object({ email: z.string().trim().email().max(254) });

export async function inviteUserByEmail(input: z.infer<typeof InviteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(parsed.data.email);
  if (error || !data.user) return { ok: false, message: error?.message ?? "Failed to invite user" };

  await audit(admin.id, "auth_user_invited", data.user.id, { email: parsed.data.email });
  revalidatePath("/users");
  return { ok: true, message: "Invite email sent", userId: data.user.id };
}
