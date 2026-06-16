import Link from "next/link";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { requestGameAction } from "../actions";

export const metadata = { title: "Game — Quiz4Win Host" };

interface Game {
  id: string; title: string; description?: string | null; mode?: string;
  category?: string | null; language?: string | null; scheduled_at: string | null;
  ended_at?: string | null; status: string; livekit_room_name?: string | null;
  prize_pool?: number | string | null; host_payout?: number | string | null;
  host_id?: string | null; time_per_question?: number | null;
  questions_count?: number | null;
}

export default async function GameDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; info?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [meRes, gameUpcoming, gameHistory] = await Promise.all([
    api<{ host: { id: string; application_status: string } }>("/host/me"),
    api<{ games: Game[] }>("/host/games/upcoming"),
    api<{ games: Game[] }>("/host/games/history"),
  ]);
  const host = meRes.ok ? meRes.data?.host : null;
  const all = [
    ...((gameUpcoming.ok && gameUpcoming.data?.games) || []),
    ...((gameHistory.ok && gameHistory.data?.games) || []),
  ];
  let game: Game | undefined = all.find((g) => g.id === id);

  if (!game) {
    const avail = await api<{ games: Game[] }>("/host/games/available");
    if (avail.ok) game = (avail.data?.games ?? []).find((g) => g.id === id);
  }

  const isAssigned = !!host && game?.host_id === host.id;
  const isAvailable = !game?.host_id && game?.status === "upcoming";
  const canRequest = host?.application_status === "approved" && isAvailable;

  return (
    <>
      <PageHeader title="Show details" back="/games" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {sp.error}
        </div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {sp.info}
        </div>
      ) : null}

      {!game ? (
        <Card><CardSubtitle>Game not found or not accessible to you.</CardSubtitle></Card>
      ) : (
        <>
          <Card className="mb-3">
            <CardHeader>
              <CardTitle>{game.title}</CardTitle>
              <StatusChip status={game.status} />
            </CardHeader>
            {game.description ? <CardSubtitle>{game.description}</CardSubtitle> : null}

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <Info label="When" value={formatDateTime(game.scheduled_at)} />
              <Info label="Category" value={game.category ?? "—"} />
              <Info label="Language" value={(game.language ?? "—").toUpperCase()} />
              <Info label="Mode" value={game.mode ?? "—"} />
              <Info label="Questions" value={String(game.questions_count ?? "—")} />
              <Info label="Per question" value={game.time_per_question ? `${game.time_per_question}s` : "—"} />
              <Info label="Prize pool" value={game.prize_pool != null ? Number(game.prize_pool).toFixed(2) : "—"} />
              <Info label="Host payout" value={game.host_payout != null ? Number(game.host_payout).toFixed(2) : "—"} />
            </div>
          </Card>

          {isAssigned && ["upcoming", "open", "live"].includes(game.status) ? (
            <Link href={`/games/${id}/stream`} className="block">
              <Card className="border border-[var(--color-q4w-primary)]/40 bg-[var(--color-q4w-primary)]/5">
                <CardHeader>
                  <CardTitle className="text-[var(--color-q4w-primary)]">Start hosting →</CardTitle>
                </CardHeader>
                <CardSubtitle>Run the stream readiness wizard, then go live.</CardSubtitle>
              </Card>
            </Link>
          ) : null}

          {canRequest ? (
            <Card className="mt-3">
              <CardTitle className="mb-2">Apply to host this show</CardTitle>
              <form action={requestGameAction} className="flex flex-col gap-3">
                <input type="hidden" name="game_id" value={id} />
                <Textarea name="note" placeholder="Why you'd be a great fit (optional)" maxLength={500} />
                <Button type="submit">Send request</Button>
              </form>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-q4w-muted)]">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
