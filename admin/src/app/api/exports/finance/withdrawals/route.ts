import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; user_id: string; amount: number; currency: string; status: string;
  requested_at: string; processed_at: string | null; completed_at: string | null;
  processed_by: string | null; transaction_reference: string | null; rejection_reason: string | null;
  profiles: { name: string; email: string; kyc_status: string } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("withdrawals")
    .select("id, user_id, amount, currency, status, requested_at, processed_at, completed_at, processed_by, transaction_reference, rejection_reason, profiles!user_id(name, email, kyc_status)")
    .order("requested_at", { ascending: false })
    .limit(50000);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("requested_at", from);
  if (to) q = q.lte("requested_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export withdrawals", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "withdrawal_id", value: (r) => r.id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "kyc_status", value: (r) => r.profiles?.kyc_status ?? null },
    { header: "amount_cents", value: (r) => r.amount },
    { header: "currency", value: (r) => r.currency },
    { header: "status", value: (r) => r.status },
    { header: "requested_at", value: (r) => r.requested_at },
    { header: "processed_at", value: (r) => r.processed_at },
    { header: "completed_at", value: (r) => r.completed_at },
    { header: "processed_by", value: (r) => r.processed_by },
    { header: "transaction_reference", value: (r) => r.transaction_reference },
    { header: "rejection_reason", value: (r) => r.rejection_reason },
  ]);
  return csvResponse(csv, `withdrawals-${todayStamp()}.csv`);
}
