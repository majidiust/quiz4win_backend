import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; user_id: string; document_type: string; status: string;
  rejection_reason: string | null; submitted_at: string; reviewed_at: string | null;
  reviewed_by: string | null;
  profiles: { name: string; email: string; nationality: string | null; date_of_birth: string | null } | null;
};

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(["super_admin", "admin", "support"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("kyc_requests")
    .select("id, user_id, document_type, status, rejection_reason, submitted_at, reviewed_at, reviewed_by, profiles!user_id(name, email, nationality, date_of_birth)")
    .order("submitted_at", { ascending: false })
    .limit(10000);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("submitted_at", from);
  if (to) q = q.lte("submitted_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export KYC", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "kyc_exported",
    target_type: "kyc",
    details: { count: rows.length, filters: { status, from, to } },
    created_at: new Date().toISOString(),
  });

  const csv = toCsv(rows, [
    { header: "kyc_id", value: (r) => r.id },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "nationality", value: (r) => r.profiles?.nationality ?? null },
    { header: "date_of_birth", value: (r) => r.profiles?.date_of_birth ?? null },
    { header: "document_type", value: (r) => r.document_type },
    { header: "status", value: (r) => r.status },
    { header: "submitted_at", value: (r) => r.submitted_at },
    { header: "reviewed_at", value: (r) => r.reviewed_at },
    { header: "reviewed_by", value: (r) => r.reviewed_by },
    { header: "rejection_reason", value: (r) => r.rejection_reason },
  ]);
  return csvResponse(csv, `kyc-${todayStamp()}.csv`);
}
