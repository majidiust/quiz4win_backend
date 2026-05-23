import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; voucher_id: string; user_id: string; redeemed_at: string;
  reward_type: string; reward_amount: number; issued_by_admin: string | null; note: string | null;
  profiles: { name: string; email: string } | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const { id: voucherId } = await params;
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("voucher_redemptions")
    .select("id, voucher_id, user_id, redeemed_at, reward_type, reward_amount, issued_by_admin, note, profiles!user_id(name, email)")
    .eq("voucher_id", voucherId)
    .order("redeemed_at", { ascending: false })
    .limit(50000);

  if (error) return new Response("Failed to export redemptions", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "voucher_redemptions_exported",
    target_type: "voucher",
    target_id: voucherId,
    details: { count: rows.length },
    created_at: new Date().toISOString(),
  });

  const csv = toCsv(rows, [
    { header: "redemption_id", value: (r) => r.id },
    { header: "voucher_id", value: (r) => r.voucher_id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "reward_type", value: (r) => r.reward_type },
    { header: "reward_amount_cents", value: (r) => r.reward_amount },
    { header: "redeemed_at", value: (r) => r.redeemed_at },
    { header: "issued_by_admin", value: (r) => r.issued_by_admin },
    { header: "note", value: (r) => r.note },
  ]);
  return csvResponse(csv, `voucher-${voucherId}-redemptions-${todayStamp()}.csv`);
}
