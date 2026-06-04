"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const LANG = ["en", "ar", "fa", "tr"] as const;
const MODE = ["timed", "battle", "daily", "tournament", "live"] as const;
const DIFF = ["Easy", "Medium", "Hard"] as const;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();

const TemplateSchema = z.object({
  // Identity
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  // Schedule
  cron_expression: z.string().trim().min(1).max(120),
  cron_description: z.string().trim().max(200).optional(),
  duration_minutes: z.number().int().min(1).max(1440).default(15),
  start_buffer_seconds: z.number().int().min(0).max(3600).default(120),
  // Game config
  mode: z.enum(MODE).default("live"),
  category: z.string().trim().max(100).optional(),
  difficulty: z.enum(DIFF).optional(),
  language: z.enum(LANG).default("en"),
  // Full set of languages every generated question must be produced in.
  // `language` is the default display language and is always force-included.
  target_languages: z.array(z.enum(LANG)).min(1).default([...LANG]),
  entry_fee: z.number().min(0).default(0),
  prize_pool: z.number().min(0).default(0),
  prize_pool_currency: z.enum(SUPPORTED_CURRENCIES).default("USD"),
  max_players: z.number().int().min(1).optional(),
  questions_count: z.number().int().min(1).max(200).default(10),
  time_per_question: z.number().int().min(3).max(300).default(15),
  allowed_wrong_answers: z.number().int().min(0).optional(),
  is_featured: z.boolean().default(false),
  tags: z.array(z.string().trim().max(50)).optional(),
  // Question filters
  question_category: z.string().trim().max(100).optional(),
  question_difficulty: z.enum(DIFF).optional(),
  question_language: z.enum(LANG).optional(),
  // Host
  host_name: z.string().trim().max(200).optional(),
  host_title: z.string().trim().max(200).optional(),
  // Streaming
  enable_streaming: z.boolean().default(true),
  // AI presenter
  ai_enabled: z.boolean().default(false),
  ai_avatar_id: z.string().trim().max(200).optional(),
  ai_sound_id: z.string().trim().max(200).optional(),
  ai_duration: z.number().int().min(60).max(1800).optional(),
  ai_language: z.enum(LANG).optional(),
  // Branding
  sponsor: z.string().trim().max(200).optional(),
  accent_color: hexColor,
  glow_color: hexColor,
  gradient_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
});

export type TemplateInput = z.infer<typeof TemplateSchema>;

export async function createTemplate(input: TemplateInput): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("game_templates")
    .insert({ ...parsed.data, created_by: admin.id })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_template_created",
    target_type: "game_template",
    target_id: data.id,
    created_at: new Date().toISOString(),
  });
  revalidatePath("/templates");
  return { ok: true, message: "Template created", id: data.id };
}

export async function updateTemplate(id: string, input: Partial<TemplateInput>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("game_templates")
    .update(input as Record<string, unknown>)
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_template_updated",
    target_type: "game_template",
    target_id: id,
    details: { fields: Object.keys(input) },
    created_at: new Date().toISOString(),
  });
  revalidatePath(`/templates/${id}`);
  revalidatePath("/templates");
  return { ok: true, message: "Template updated" };
}

export async function setTemplateActive(id: string, active: boolean): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("game_templates")
    .update({ is_active: active })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: active ? "game_template_activated" : "game_template_deactivated",
    target_type: "game_template",
    target_id: id,
    created_at: new Date().toISOString(),
  });
  revalidatePath(`/templates/${id}`);
  revalidatePath("/templates");
  return { ok: true, message: active ? "Template activated" : "Template deactivated" };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("game_templates")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_template_deleted",
    target_type: "game_template",
    target_id: id,
    created_at: new Date().toISOString(),
  });
  revalidatePath("/templates");
  return { ok: true, message: "Template deleted" };
}

export async function generateNow(id: string, skipOverlap = false): Promise<ActionResult & { game_id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();
  const { data: gameId, error } = await db.rpc("generate_game_from_template", {
    p_template_id: id,
    p_skip_overlap: skipOverlap,
  });
  if (error) return { ok: false, message: error.message };
  if (!gameId) return { ok: false, message: "Template already has an active/upcoming game" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_template_generated_now",
    target_type: "game_template",
    target_id: id,
    details: { game_id: gameId, skip_overlap: skipOverlap },
    created_at: new Date().toISOString(),
  });
  revalidatePath(`/templates/${id}`);
  revalidatePath("/templates");
  return { ok: true, message: "Game generated", game_id: gameId as string };
}
