import Link from "next/link";
import { ArrowLeft, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAdmin } from "@/lib/auth";
import { listRoomParticipants, listEgress } from "@/lib/actions/livekit";
import { EndRoomButton, SendDataDialog, KickParticipantButton, MuteTrackButton, EgressToggleButton } from "../livekit-actions";

export const metadata = { title: "LiveKit Room" };

interface LKParticipant {
  identity?: string;
  name?: string;
  state?: string;
  joined_at?: number;
  tracks?: Array<{ sid?: string; type?: string; muted?: boolean; name?: string }>;
}

interface LKEgress {
  egress_id?: string;
  room_name?: string;
  status?: string;
  started_at?: string;
}

export default async function RoomDetailPage({ params }: { params: Promise<{ room: string }> }) {
  await requireAdmin(["super_admin", "admin"]);
  const { room } = await params;
  const [{ participants, configured }, { items: egressItems }] = await Promise.all([
    listRoomParticipants(room),
    listEgress(room),
  ]);
  const active = (egressItems as LKEgress[]).find((e) => e.status && !["EGRESS_COMPLETE", "EGRESS_ABORTED", "EGRESS_FAILED"].includes(e.status));

  return (
    <>
      <PageHeader
        title={room}
        description="Room participants and recording control."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/livekit"><ArrowLeft className="size-4" /> Back</Link>
            </Button>
            <SendDataDialog room={room} />
            <EgressToggleButton room={room} egressId={active?.egress_id} />
            <EndRoomButton room={room} />
          </div>
        }
      />

      {!configured ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          LiveKit not configured. Set LIVEKIT_SERVER_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {participants.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Tracks</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(participants as LKParticipant[]).map((p) => (
                  <TableRow key={p.identity}>
                    <TableCell className="font-mono text-xs">{p.identity}</TableCell>
                    <TableCell className="text-sm">{p.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{p.state}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(p.tracks ?? []).map((t) => (
                          <div key={t.sid} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
                            <span>{t.type}</span>
                            <MuteTrackButton room={room} identity={p.identity!} trackSid={t.sid!} muted={!!t.muted} />
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <KickParticipantButton room={room} identity={p.identity!} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={Video} title="No participants" />
          )}
        </Card>
      )}

      {egressItems.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b px-4 py-3 text-sm font-medium">Egress jobs</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Egress ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(egressItems as LKEgress[]).map((e) => (
                <TableRow key={e.egress_id}>
                  <TableCell className="font-mono text-xs">{e.egress_id}</TableCell>
                  <TableCell className="text-xs">{e.status}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.started_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
