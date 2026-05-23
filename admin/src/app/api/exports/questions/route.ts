import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; text: string; options: unknown; correct_answer: unknown;
  category: string; difficulty: string; time_limit_sec: number; is_active: boolean; created_at: string;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const difficulty = searchParams.get("difficulty");

  let q = db
    .from("questions")
    .select("id, text, options, correct_answer, category, difficulty, time_limit_sec, is_active, created_at")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(50000);
  if (category) q = q.eq("category", category);
  if (difficulty) q = q.eq("difficulty", difficulty);

  const { data, error } = await q;
  if (error) return new Response("Failed to export questions", { status: 500 });
  const rows = (data ?? []) as Row[];

  const csv = toCsv(rows, [
    { header: "id", value: (r) => r.id },
    { header: "text", value: (r) => r.text },
    { header: "options", value: (r) => JSON.stringify(r.options) },
    {
      header: "correct_answer",
      value: (r) => (typeof r.correct_answer === "string" ? r.correct_answer : JSON.stringify(r.correct_answer)),
    },
    { header: "category", value: (r) => r.category },
    { header: "difficulty", value: (r) => r.difficulty },
    { header: "time_limit_sec", value: (r) => r.time_limit_sec },
    { header: "is_active", value: (r) => r.is_active },
    { header: "created_at", value: (r) => r.created_at },
  ]);
  return csvResponse(csv, `questions-${todayStamp()}.csv`);
}
