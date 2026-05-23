import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; user_id: string; withdrawal_id: string | null; total_24h_usd: number | string;
  status: string; notes: string | null; flagged_at: string; reviewed_at: string | null;
  reviewed_by: string | null;
  profiles: { name: string; email: string; nationality: string | null } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("aml_flags")
    .select("id, user_id, withdrawal_id, total_24h_usd, status, notes, flagged_at, reviewed_at, reviewed_by, profiles!aml_flags_user_id_fkey(name, email, nationality)")
    .order("flagged_at", { ascending: false })
    .limit(50000);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("flagged_at", from);
  if (to) q = q.lte("flagged_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export AML flags", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "flag_id", value: (r) => r.id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "nationality", value: (r) => r.profiles?.nationality ?? null },
    { header: "withdrawal_id", value: (r) => r.withdrawal_id },
    { header: "total_24h_usd", value: (r) => r.total_24h_usd },
    { header: "status", value: (r) => r.status },
    { header: "flagged_at", value: (r) => r.flagged_at },
    { header: "reviewed_at", value: (r) => r.reviewed_at },
    { header: "reviewed_by", value: (r) => r.reviewed_by },
    { header: "notes", value: (r) => r.notes },
  ]);
  return csvResponse(csv, `aml-${todayStamp()}.csv`);
}
