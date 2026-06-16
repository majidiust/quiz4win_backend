import { redirect } from "next/navigation";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { StreamWizard } from "./stream-wizard";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Start stream — Quiz4Win Host" };

interface Session { id: string; status: string; camera_ok: boolean; mic_ok: boolean; connection_ok: boolean; }
interface Game { id: string; title: string; scheduled_at: string | null; status: string; host_id?: string | null; livekit_room_name?: string | null; }

export default async function StreamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api<{ session: Session | null; game: Game }>(`/host/games/${id}/stream-session`);
  if (!r.ok) {
    if (r.error === "not_assigned_to_this_game") redirect(`/games/${id}?error=Not%20assigned`);
    if (r.error === "game_not_found" || r.status === 404) redirect("/games");
    redirect(`/games/${id}?error=${encodeURIComponent(r.error)}`);
  }
  const { session, game } = r.data!;
  return (
    <>
      <PageHeader title="Stream readiness" subtitle={game.title} back={`/games/${id}`} />

      <Card className="mb-3">
        <CardTitle>{game.title}</CardTitle>
        <CardSubtitle>{formatDateTime(game.scheduled_at)}</CardSubtitle>
      </Card>

      <StreamWizard
        gameId={id}
        initialSession={session}
        livekitRoom={game.livekit_room_name ?? `game-${id}`}
      />
    </>
  );
}
