import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; admin_id: string; action: string; target_type: string | null;
  target_id: string | null; details: unknown; created_at: string;
  admin_users: { name: string; email: string; role: string } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const adminId = searchParams.get("admin_id");
  const actionFilter = searchParams.get("action");
  const targetType = searchParams.get("target_type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("admin_audit_log")
    .select("id, admin_id, action, target_type, target_id, details, created_at, admin_users!admin_id(name, email, role)")
    .order("created_at", { ascending: false })
    .limit(50000);
  if (adminId) q = q.eq("admin_id", adminId);
  if (actionFilter) q = q.ilike("action", `%${actionFilter}%`);
  if (targetType) q = q.eq("target_type", targetType);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export audit log", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "event_id", value: (r) => r.id },
    { header: "admin_id", value: (r) => r.admin_id },
    { header: "admin_name", value: (r) => r.admin_users?.name ?? null },
    { header: "admin_email", value: (r) => r.admin_users?.email ?? null },
    { header: "admin_role", value: (r) => r.admin_users?.role ?? null },
    { header: "action", value: (r) => r.action },
    { header: "target_type", value: (r) => r.target_type },
    { header: "target_id", value: (r) => r.target_id },
    { header: "details", value: (r) => (r.details ? JSON.stringify(r.details) : null) },
    { header: "created_at", value: (r) => r.created_at },
  ]);
  return csvResponse(csv, `audit-log-${todayStamp()}.csv`);
}
