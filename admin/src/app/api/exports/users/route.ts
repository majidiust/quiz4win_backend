import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(["super_admin", "admin", "support", "finance"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const kyc = searchParams.get("kyc_status");
  const search = searchParams.get("q");

  let q = db
    .from("profiles")
    .select("id, name, email, nationality, status, kyc_status, wallet_balance, created_at")
    .order("created_at", { ascending: false })
    .limit(10000);
  if (status) q = q.eq("status", status);
  if (kyc) q = q.eq("kyc_status", kyc);
  if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return new Response("Failed to export users", { status: 500 });

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "users_exported",
    target_type: "users",
    details: { count: data?.length ?? 0, filters: { status, kyc, search } },
    created_at: new Date().toISOString(),
  });

  const csv = toCsv(data ?? [], [
    { header: "id", value: (r) => r.id },
    { header: "name", value: (r) => r.name },
    { header: "email", value: (r) => r.email },
    { header: "nationality", value: (r) => r.nationality },
    { header: "status", value: (r) => r.status },
    { header: "kyc_status", value: (r) => r.kyc_status },
    { header: "wallet_balance_cents", value: (r) => r.wallet_balance ?? 0 },
    { header: "created_at", value: (r) => r.created_at },
  ]);
  return csvResponse(csv, `users-${todayStamp()}.csv`);
}
