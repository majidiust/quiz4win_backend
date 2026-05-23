import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  id: string; ticket_number: string; subject: string; category: string;
  status: string; priority: string | null; user_id: string; assigned_to: string | null;
  created_at: string; updated_at: string;
  profiles: { name: string; email: string } | null;
};

export async function GET(req: NextRequest) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const db = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let q = db
    .from("support_tickets")
    .select("id, ticket_number, subject, category, status, priority, user_id, assigned_to, created_at, updated_at, profiles!user_id(name, email)")
    .order("created_at", { ascending: false })
    .limit(50000);
  if (status) q = q.eq("status", status);
  if (category) q = q.eq("category", category);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) return new Response("Failed to export support tickets", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const csv = toCsv(rows, [
    { header: "ticket_id", value: (r) => r.id },
    { header: "ticket_number", value: (r) => r.ticket_number },
    { header: "subject", value: (r) => r.subject },
    { header: "category", value: (r) => r.category },
    { header: "status", value: (r) => r.status },
    { header: "priority", value: (r) => r.priority },
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "assigned_to", value: (r) => r.assigned_to },
    { header: "created_at", value: (r) => r.created_at },
    { header: "updated_at", value: (r) => r.updated_at },
  ]);
  return csvResponse(csv, `support-tickets-${todayStamp()}.csv`);
}
