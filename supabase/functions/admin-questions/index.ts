/**
 * Admin Questions Edge Function — Quiz4Win
 *
 * GET    /admin/questions                  — List questions (API #94)
 * GET    /admin/questions/categories       — List categories (API #100)
 * GET    /admin/questions/:id              — Question detail (API #95)
 * POST   /admin/questions                  — Create question (API #96)
 * PATCH  /admin/questions/:id             — Update question (API #97)
 * DELETE /admin/questions/:id             — Soft-delete (API #98)
 * POST   /admin/questions/bulk-import     — Bulk import (API #99)
 * GET    /admin/questions/export          — Bulk export CSV (row 143)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/questions\/?/, "").split("/").filter(Boolean);
  const questionId = parts[0] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/questions/export — CSV (row 143)
    if (questionId === "export" && req.method === "GET") {
      const category = url.searchParams.get("category");
      const difficulty = url.searchParams.get("difficulty");
      let q = admin.from("questions").select("id, text, options, correct_answer, category, difficulty, time_limit_sec, is_active, created_at").eq("is_deleted", false).order("created_at", { ascending: false }).limit(50000);
      if (category) q = q.eq("category", category);
      if (difficulty) q = q.eq("difficulty", difficulty);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export questions", 500);
      type Row = { id: string; text: string; options: unknown; correct_answer: unknown; category: string; difficulty: string; time_limit_sec: number; is_active: boolean; created_at: string };
      const rows = (data ?? []) as Row[];
      const csv = toCsv(rows, [
        { header: "id", value: (r) => r.id },
        { header: "text", value: (r) => r.text },
        { header: "options", value: (r) => JSON.stringify(r.options) },
        { header: "correct_answer", value: (r) => typeof r.correct_answer === "string" ? r.correct_answer : JSON.stringify(r.correct_answer) },
        { header: "category", value: (r) => r.category },
        { header: "difficulty", value: (r) => r.difficulty },
        { header: "time_limit_sec", value: (r) => r.time_limit_sec },
        { header: "is_active", value: (r) => r.is_active },
        { header: "created_at", value: (r) => r.created_at },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "questions_exported", target_type: "questions", details: { count: rows.length, filters: { category, difficulty } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `questions-${todayStamp()}.csv`);
    }

    // GET /admin/questions/categories
    if (questionId === "categories" && req.method === "GET") {
      const { data, error } = await admin.from("questions").select("category").not("category", "is", null).order("category");
      if (error) return errorResponse("Failed to fetch categories", 500);
      const categories = [...new Set((data ?? []).map((r: { category: string }) => r.category))].sort();
      return successResponse({ categories });
    }

    // POST /admin/questions/bulk-import
    if (questionId === "bulk-import" && req.method === "POST") {
      const { questions } = await req.json();
      if (!Array.isArray(questions) || questions.length === 0) return errorResponse("questions array is required", 400);
      if (questions.length > 500) return errorResponse("Maximum 500 questions per import", 400);

      const rows = questions.map((q: Record<string, unknown>) => ({
        text: q.text,
        options: q.options,
        correct_answer: q.correct_answer,
        category: q.category ?? "general",
        difficulty: q.difficulty ?? "medium",
        time_limit_sec: q.time_limit_sec ?? 30,
        is_active: true,
        created_by: user.id,
        created_at: new Date().toISOString(),
      }));

      const { data, error } = await admin.from("questions").insert(rows).select("id");
      if (error) return errorResponse(sanitizeError(error), 400);

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "questions_bulk_imported", target_type: "questions", details: { count: data?.length ?? 0 }, created_at: new Date().toISOString() });
      return successResponse({ imported: data?.length ?? 0 }, 201);
    }

    // GET /admin/questions
    if (!questionId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const category = url.searchParams.get("category");
      const difficulty = url.searchParams.get("difficulty");
      const q = url.searchParams.get("q");
      const offset = (page - 1) * limit;

      let query = admin.from("questions").select("id, text, category, difficulty, time_limit_sec, is_active, created_at", { count: "exact" }).eq("is_deleted", false).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (category) query = query.eq("category", category);
      if (difficulty) query = query.eq("difficulty", difficulty);
      if (q) query = query.ilike("text", `%${q}%`);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to list questions", 500);
      return successResponse({ questions: data ?? [], pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /admin/questions/:id
    if (questionId && req.method === "GET") {
      const { data, error } = await admin.from("questions").select("*").eq("id", questionId).eq("is_deleted", false).single();
      if (error || !data) return errorResponse("question_not_found", 404);
      return successResponse({ question: data });
    }

    // POST /admin/questions
    if (!questionId && req.method === "POST") {
      const body = await req.json();
      const required = ["text", "options", "correct_answer"];
      for (const f of required) { if (body[f] === undefined) return errorResponse(`${f} is required`, 400); }

      const { data, error } = await admin.from("questions").insert({ ...body, is_active: true, is_deleted: false, created_by: user.id, created_at: new Date().toISOString() }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ question: data }, 201);
    }

    // PATCH /admin/questions/:id
    if (questionId && req.method === "PATCH") {
      const body = await req.json();
      const { data, error } = await admin.from("questions").update({ ...body, updated_at: new Date().toISOString() }).eq("id", questionId).eq("is_deleted", false).select("*").single();
      if (error || !data) return errorResponse(data ? sanitizeError(error!) : "question_not_found", data ? 400 : 404);
      return successResponse({ question: data });
    }

    // DELETE /admin/questions/:id — soft delete
    if (questionId && req.method === "DELETE") {
      await admin.from("questions").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", questionId);
      return successResponse({ message: "Question deleted" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-questions] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
