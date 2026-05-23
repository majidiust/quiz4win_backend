import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, todayStamp } from "@/lib/csv";

type Row = {
  user_id: string; score: number | null; rank: number | null;
  prize_amount: number | null; prize_credited: boolean | null; joined_at: string;
  profiles: { name: string; email: string } | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id: gameId } = await params;
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("game_participants")
    .select("user_id, score, rank, prize_amount, prize_credited, joined_at, profiles!user_id(name, email)")
    .eq("game_id", gameId)
    .order("rank", { ascending: true, nullsFirst: false });

  if (error) return new Response("Failed to export game results", { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_results_exported",
    target_type: "game",
    target_id: gameId,
    details: { count: rows.length },
    created_at: new Date().toISOString(),
  });

  const csv = toCsv(rows, [
    { header: "user_id", value: (r) => r.user_id },
    { header: "name", value: (r) => r.profiles?.name ?? null },
    { header: "email", value: (r) => r.profiles?.email ?? null },
    { header: "rank", value: (r) => r.rank },
    { header: "score", value: (r) => r.score },
    { header: "prize_amount_cents", value: (r) => r.prize_amount },
    { header: "prize_credited", value: (r) => r.prize_credited },
    { header: "joined_at", value: (r) => r.joined_at },
  ]);
  return csvResponse(csv, `game-${gameId}-results-${todayStamp()}.csv`);
}
