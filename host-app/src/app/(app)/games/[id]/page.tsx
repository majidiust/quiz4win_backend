import Link from "next/link";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { requestGameAction, cancelRequestAction, acceptGameAction, rejectGameAction } from "../actions";

export const metadata = { title: "Game — Quiz4Win Host" };

interface Game {
  id: string; title: string; description?: string | null; mode?: string;
  category?: string | null; language?: string | null; scheduled_at: string | null;
  ended_at?: string | null; status: string; livekit_room_name?: string | null;
  prize_pool?: number | string | null;
  host_id?: string | null; time_per_question?: number | null;
  questions_count?: number | null;
  host_assignment_status?: string | null;
  host_fee?: number | string | null;
  host_commission_pct?: number | string | null;
}

export default async function GameDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; info?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [meRes, gameUpcoming, gameHistory, reqsRes] = await Promise.all([
    api<{ host: { id: string; application_status: string } }>("/host/me"),
    api<{ games: Game[] }>("/host/games/upcoming"),
    api<{ games: Game[] }>("/host/games/history"),
    api<{ requests: Array<{ id: string; game_id: string; status: string; host_note: string | null; admin_note: string | null; created_at: string }> }>("/host/games/requests"),
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

  const myRequest = (reqsRes.ok ? reqsRes.data?.requests ?? [] : []).find((r) => r.game_id === id);
  const pendingRequest = myRequest && myRequest.status === "pending" ? myRequest : null;
  const closedRequest  = myRequest && ["rejected", "cancelled"].includes(myRequest.status) ? myRequest : null;

  const isAssigned = !!host && game?.host_id === host.id;
  const isAvailable = !game?.host_id && game?.status === "upcoming";
  const canRequest = host?.application_status === "approved" && isAvailable && !pendingRequest;
  // Direct assignment awaiting the host's accept/reject decision.
  const pendingAssignment = isAssigned && game?.host_assignment_status === "pending";
  const acceptedAssignment = isAssigned && game?.host_assignment_status === "accepted";
  // maskFeeFields nulls these out when the admin disabled visibility.
  const showFee = game?.host_fee != null;
  const showCommission = game?.host_commission_pct != null;

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
              {showFee ? <Info label="Host fee" value={`$${Number(game.host_fee).toFixed(2)}`} /> : null}
              {showCommission ? <Info label="Commission" value={`${Number(game.host_commission_pct)}%`} /> : null}
            </div>
            {(showFee || showCommission) ? (
              <p className="mt-3 text-[10px] text-[var(--color-q4w-muted)]">
                Commission is calculated on the total income we collect for this show and is credited to your wallet once the show settles.
              </p>
            ) : null}
          </Card>

          {pendingAssignment ? (
            <Card className="mb-3 border border-[var(--color-q4w-primary)]/40 bg-[var(--color-q4w-primary)]/5">
              <CardTitle className="mb-1">You&apos;ve been assigned to host this show</CardTitle>
              <CardSubtitle className="mb-3">
                Please review the details above and confirm whether you can host. Rejecting returns the show to the pool.
              </CardSubtitle>
              <form action={acceptGameAction} className="mb-3">
                <input type="hidden" name="game_id" value={id} />
                <Button type="submit">Accept assignment</Button>
              </form>
              <form action={rejectGameAction} className="flex flex-col gap-2">
                <input type="hidden" name="game_id" value={id} />
                <Textarea name="note" placeholder="Reason for rejecting (optional)" maxLength={500} />
                <Button type="submit" variant="secondary">Reject assignment</Button>
              </form>
            </Card>
          ) : null}

          {acceptedAssignment && ["upcoming", "open", "live"].includes(game.status) ? (
            <Link href={`/games/${id}/stream`} className="block">
              <Card className="border border-[var(--color-q4w-primary)]/40 bg-[var(--color-q4w-primary)]/5">
                <CardHeader>
                  <CardTitle className="text-[var(--color-q4w-primary)]">Start hosting →</CardTitle>
                </CardHeader>
                <CardSubtitle>Run the stream readiness wizard, then go live.</CardSubtitle>
              </Card>
            </Link>
          ) : null}

          {pendingRequest ? (
            <Card className="mt-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Request pending review</CardTitle>
                  <CardSubtitle>
                    Sent {formatDateTime(pendingRequest.created_at)}. We&apos;ll notify you when an admin responds.
                  </CardSubtitle>
                </div>
                <StatusChip status={pendingRequest.status} />
              </div>
              {pendingRequest.host_note ? (
                <div className="mt-3 rounded-xl border border-[var(--color-q4w-border)] bg-white/5 p-3 text-xs text-[var(--color-q4w-text)]">
                  &quot;{pendingRequest.host_note}&quot;
                </div>
              ) : null}
              <form action={cancelRequestAction} className="mt-3">
                <input type="hidden" name="request_id" value={pendingRequest.id} />
                <Button type="submit" variant="secondary">Withdraw request</Button>
              </form>
            </Card>
          ) : null}

          {closedRequest && isAvailable ? (
            <div className="mt-3 rounded-2xl border border-[var(--color-q4w-border)] bg-white/5 p-3 text-xs text-[var(--color-q4w-muted)]">
              Your earlier request was {closedRequest.status}
              {closedRequest.admin_note ? ` — "${closedRequest.admin_note}"` : "."} You can apply again below.
            </div>
          ) : null}

          {canRequest ? (
            <Card className="mt-3">
              <CardTitle className="mb-1">Apply to host this show</CardTitle>
              <CardSubtitle className="mb-3">
                Quiz4Win admins review every request — you&apos;ll get a notification with the decision.
              </CardSubtitle>
              <form action={requestGameAction} className="flex flex-col gap-3">
                <input type="hidden" name="game_id" value={id} />
                <Textarea name="note" placeholder="Why you'd be a great fit (optional)" maxLength={500} />
                <Button type="submit">Send request</Button>
              </form>
            </Card>
          ) : null}

          {!canRequest && !pendingRequest && isAvailable && host?.application_status !== "approved" ? (
            <Card className="mt-3 border border-amber-400/30 bg-amber-500/5">
              <CardTitle className="mb-1">Approval required</CardTitle>
              <CardSubtitle>
                Your host application is {host?.application_status ?? "not submitted"}. You&apos;ll be able to apply for shows once an admin approves your profile.
              </CardSubtitle>
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
