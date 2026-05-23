import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; user_id: string; type: string; amount: number; currency: string;
  status: string; description: string | null; reference_id: string | null; created_at: string;
  profiles: { name: string; email: string } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("transactions")
    .select("id, user_id, type, amount, currency, status, description, reference_id, created_at, profiles!user_id(name, email)")
    .order("created_at", { ascending: false })
    .limit(50000);
  if (type) q = q.eq("type", type);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export transactions", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "transaction_id", value: (r) => r.id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "type", value: (r) => r.type },
    { header: "amount_cents", value: (r) => r.amount },
    { header: "currency", value: (r) => r.currency },
    { header: "status", value: (r) => r.status },
    { header: "reference_id", value: (r) => r.reference_id },
    { header: "description", value: (r) => r.description },
    { header: "created_at", value: (r) => r.created_at },
  ]);
  return csvResponse(csv, `transactions-${todayStamp()}.csv`);
}
