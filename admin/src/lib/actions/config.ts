"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

/* ------------------------------------------------------------------ */
/* Update a single config key                                           */
/* ------------------------------------------------------------------ */
export async function updateConfigKey(key: string, value: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!key.trim()) return { ok: false, message: "Key is required" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("app_config").upsert(
    { key, value, updated_by: admin.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: "Failed to update config" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "config_updated",
    target_type: "app_config",
    details: { key },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/config");
  return { ok: true, message: `Config key "${key}" updated` };
}

/* ------------------------------------------------------------------ */
/* Maintenance mode toggle                                              */
/* ------------------------------------------------------------------ */
export async function toggleMaintenanceMode(enabled: boolean, message?: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const rows = [
    { key: "maintenance_mode", value: String(enabled), updated_by: admin.id, updated_at: now },
    ...(message ? [{ key: "maintenance_message", value: message, updated_by: admin.id, updated_at: now }] : []),
  ];

  const { error } = await db.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, message: "Failed to toggle maintenance mode" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: enabled ? "maintenance_enabled" : "maintenance_disabled",
    target_type: "app_config",
    created_at: now,
  });

  revalidatePath("/config");
  return { ok: true, message: `Maintenance mode ${enabled ? "enabled" : "disabled"}` };
}

/* ------------------------------------------------------------------ */
/* Help articles                                                        */
/* ------------------------------------------------------------------ */
const ArticleSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1),
  category: z.enum(["payments", "kyc", "games", "account", "general"]),
  language: z.enum(["en", "ar", "fa", "tr"]).default("en"),
  is_published: z.boolean().default(false),
});

export async function createHelpArticle(input: z.infer<typeof ArticleSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = ArticleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("help_articles").insert({
    ...parsed.data,
    created_by: admin.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Failed to create help article" };

  revalidatePath("/config");
  return { ok: true, message: "Help article created" };
}

export async function toggleHelpArticle(id: string, is_published: boolean): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("help_articles")
    .update({ is_published, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: "Failed to update article" };
  revalidatePath("/config");
  return { ok: true, message: is_published ? "Article published" : "Article unpublished" };
}
