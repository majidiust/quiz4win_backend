import Link from "next/link";
import { Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { CreateRoomDialog, EndRoomButton } from "./livekit-actions";

export const metadata = { title: "LiveKit Rooms" };

export default async function LiveKitPage() {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("games")
    .select("id, title, status, livekit_room_name, viewer_count, total_participants, started_at, scheduled_at")
    .in("status", ["open", "live", "upcoming"])
    .not("livekit_room_name", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="LiveKit Rooms"
        description="Active broadcast rooms — view counts and operator controls."
        actions={<CreateRoomDialog />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Live and upcoming rooms</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {data && data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Game</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Viewers</TableHead>
                  <TableHead className="text-right">Players</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-xs">
                      {g.livekit_room_name ? (
                        <Link href={`/livekit/${encodeURIComponent(g.livekit_room_name)}`} className="hover:underline">
                          {g.livekit_room_name}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{g.title}</TableCell>
                    <TableCell><StatusBadge value={g.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(g.viewer_count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(g.total_participants ?? 0)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.started_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.scheduled_at)}</TableCell>
                    <TableCell>
                      {g.livekit_room_name && g.status === "live" ? (
                        <EndRoomButton room={g.livekit_room_name} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={Video} title="No active rooms" description="Start a game to provision a LiveKit room." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
