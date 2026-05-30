import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; user_id: string; method: string; provider: string; amount_cents: number; currency: string;
  status: string; provider_payment_id: string | null; provider_short_id: string | null; 
  transaction_id: string | null; created_at: string; completed_at: string | null;
  profiles: { name: string; email: string } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const method = searchParams.get("method");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("payments")
    .select("id, user_id, method, provider, amount_cents, currency, status, provider_payment_id, provider_short_id, transaction_id, created_at, completed_at, profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(50000);

  if (method) q = q.eq("method", method);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export payments", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "payment_id", value: (r) => r.id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? (r.profiles as any)?.full_name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "method", value: (r) => r.method },
    { header: "provider", value: (r) => r.provider },
    { header: "amount_cents", value: (r) => r.amount_cents },
    { header: "currency", value: (r) => r.currency },
    { header: "status", value: (r) => r.status },
    { header: "provider_payment_id", value: (r) => r.provider_payment_id },
    { header: "provider_short_id", value: (r) => r.provider_short_id },
    { header: "transaction_id", value: (r) => r.transaction_id },
    { header: "created_at", value: (r) => r.created_at },
    { header: "completed_at", value: (r) => r.completed_at },
  ]);

  return csvResponse(csv, `payments-${todayStamp()}.csv`);
}
