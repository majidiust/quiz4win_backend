"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

// OpenAI-only for now (R-01: no API key stored here — the orchestrator reads
// OPENAI_API_KEY from the environment). Only the editable generation knobs live
// in the row.
const LlmTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  model: z.string().trim().min(1).max(100).default("gpt-4o-mini"),
  system_prompt: z.string().trim().min(1).max(20000),
  temperature: z.number().min(0).max(2).default(0.8),
  max_tokens: z.number().int().min(256).max(8192).default(1500),
});

export type LlmTemplateInput = z.infer<typeof LlmTemplateSchema>;

export async function createLlmTemplate(
  input: LlmTemplateInput,
): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = LlmTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("llm_prompt_templates")
    .insert({ ...parsed.data, provider: "openai", created_by: admin.id, updated_by: admin.id })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "llm_template_created",
    target_type: "llm_prompt_template",
    target_id: data.id,
    created_at: new Date().toISOString(),
  });
  revalidatePath("/llm-templates");
  return { ok: true, message: "LLM template created", id: data.id };
}

export async function updateLlmTemplate(
  id: string,
  input: Partial<LlmTemplateInput>,
): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("llm_prompt_templates")
    .update({ ...(input as Record<string, unknown>), updated_by: admin.id })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "llm_template_updated",
    target_type: "llm_prompt_template",
    target_id: id,
    details: { fields: Object.keys(input) },
    created_at: new Date().toISOString(),
  });
  revalidatePath("/llm-templates");
  return { ok: true, message: "LLM template updated" };
}

// Promotes one template to the single global default. Uses the SECURITY DEFINER
// RPC so the "exactly one active" invariant is enforced atomically server-side.
export async function setActiveLlmTemplate(id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db.rpc("set_active_llm_template", { p_id: id });
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "llm_template_activated",
    target_type: "llm_prompt_template",
    target_id: id,
    created_at: new Date().toISOString(),
  });
  revalidatePath("/llm-templates");
  return { ok: true, message: "Default LLM template updated" };
}

export async function deleteLlmTemplate(id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("llm_prompt_templates")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "llm_template_deleted",
    target_type: "llm_prompt_template",
    target_id: id,
    created_at: new Date().toISOString(),
  });
  revalidatePath("/llm-templates");
  return { ok: true, message: "LLM template deleted" };
}
