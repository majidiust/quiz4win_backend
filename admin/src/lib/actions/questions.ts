"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
  id?: string;
}

const QuestionSchema = z.object({
  text: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).length(4),
  correct_index: z.number().int().min(0).max(3),
  category: z.string().trim().min(1).max(80),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  language: z.enum(["en", "ar", "fa", "tr"]).default("en"),
  explanation: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(300).optional(),
  media_url: z.string().url().optional(),
});

export async function createQuestion(input: z.infer<typeof QuestionSchema>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const parsed = QuestionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("questions")
    .insert({ ...parsed.data, active: true, created_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };
  revalidatePath("/questions");
  return { ok: true, message: "Question created", id: data.id };
}

export async function updateQuestion(
  questionId: string,
  input: Partial<z.infer<typeof QuestionSchema>>,
): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("questions")
    .update({ ...input, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", questionId)
    .is("deleted_at", null);

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return { ok: true, message: "Question updated" };
}

export async function toggleQuestion(questionId: string, active: boolean): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("questions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", questionId);

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return { ok: true, message: active ? "Question activated" : "Question deactivated" };
}

export async function deleteQuestion(questionId: string): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("questions")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", questionId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/questions");
  return { ok: true, message: "Question deleted" };
}

/* ------------------------------------------------------------------ */
/* Bulk import                                                          */
/* ------------------------------------------------------------------ */

const BulkQuestionSchema = z.object({
  text: z.string().trim().min(5),
  options: z.array(z.string().trim().min(1)).length(4),
  correct_index: z.number().int().min(0).max(3),
  category: z.string().trim().min(1).max(80),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  language: z.enum(["en", "ar", "fa", "tr"]).optional().default("en"),
  explanation: z.string().trim().max(1000).optional(),
});

export async function bulkImportQuestions(
  rawJson: string,
): Promise<ActionResult & { imported?: number }> {
  await requireAdmin(["super_admin", "admin"]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, message: "Invalid JSON" };
  }

  if (!Array.isArray(parsed)) return { ok: false, message: "JSON must be an array of questions" };
  if (parsed.length === 0) return { ok: false, message: "Array is empty" };
  if (parsed.length > 500) return { ok: false, message: "Maximum 500 questions per import" };

  const rows = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = BulkQuestionSchema.safeParse(parsed[i]);
    if (!result.success) return { ok: false, message: `Row ${i + 1}: ${result.error.issues[0]?.message}` };
    rows.push({ ...result.data, active: true, created_at: new Date().toISOString() });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("questions").insert(rows).select("id");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/questions");
  return { ok: true, message: `Imported ${data?.length ?? rows.length} questions`, imported: data?.length ?? rows.length };
}
