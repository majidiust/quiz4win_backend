import Link from "next/link";
import { Card, CardSubtitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { cancelRequestAction } from "./actions";

export const metadata = { title: "Games — Quiz4Win Host" };

type Tab = "available" | "upcoming" | "history" | "requests";
interface Game {
  id: string; title: string; mode?: string; category?: string | null; language?: string | null;
  scheduled_at: string | null; ended_at?: string | null;
  prize_pool?: number | string | null; host_payout?: number | string | null;
  status: string;
}
interface HostRequest {
  id: string; game_id: string; status: string; host_note: string | null;
  admin_note: string | null; created_at: string;
  games?: { id: string; title: string; scheduled_at: string | null; status: string } | null;
}

export default async function GamesPage({
  searchParams,
}: { searchParams: Promise<{ tab?: Tab }> }) {
  const sp = await searchParams;
  const TABS = ["available", "upcoming", "history", "requests"] as const;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "available";

  // Always fetch the host's pending requests in parallel — used to decorate
  // available cards with a "Requested ✓" badge and to power the Requests tab.
  const [listRes, reqsRes] = await Promise.all([
    tab === "requests"
      ? Promise.resolve({ ok: true, data: { games: [] as Game[] } } as const)
      : api<{ games: Game[] }>(
          tab === "available" ? "/host/games/available"
          : tab === "upcoming" ? "/host/games/upcoming"
          : "/host/games/history",
        ),
    api<{ requests: HostRequest[] }>("/host/games/requests"),
  ]);
  const games = (listRes.ok ? listRes.data?.games ?? [] : []) as Game[];
  const requests = (reqsRes.ok ? reqsRes.data?.requests ?? [] : []) as HostRequest[];
  // Surface API failures so an empty UI doesn't masquerade as "no data".
  // host_not_approved is expected on the apply path — we don't show it as
  // an error on the read-only games list.
  const listErr = !listRes.ok && tab !== "requests"
    ? (listRes.status === 401 ? "Your session expired — please sign in again."
       : listRes.status === 403 ? null
       : `Couldn't load games (${listRes.error}).`)
    : null;
  const requestedByGame = new Map(
    requests.filter((r) => r.status === "pending" || r.status === "approved").map((r) => [r.game_id, r]),
  );

  return (
    <>
      <PageHeader title="Games" subtitle="Browse, request, manage." />

      <div className="glass mb-4 inline-flex w-full rounded-full p-1">
        {TABS.map((t) => {
          const badgeCount = t === "requests"
            ? requests.filter((r) => r.status === "pending").length
            : 0;
          return (
            <Link
              key={t}
              href={`/games?tab=${t}`}
              className={`flex flex-1 items-center justify-center gap-1 rounded-full px-3 py-2 text-center text-xs font-medium capitalize ${
                tab === t ? "bg-[var(--color-q4w-primary)] text-white" : "text-[var(--color-q4w-muted)]"
              }`}
            >
              {t}
              {badgeCount > 0 ? (
                <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                  tab === t ? "bg-white/25 text-white" : "bg-[var(--color-q4w-primary)]/20 text-[var(--color-q4w-primary)]"
                }`}>{badgeCount}</span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {listErr ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {listErr}
        </div>
      ) : null}

      {tab === "requests" ? (
        <RequestsList requests={requests} />
      ) : (
        <GamesList games={games} tab={tab} requestedByGame={requestedByGame} />
      )}
    </>
  );
}

function GamesList({
  games, tab, requestedByGame,
}: { games: Game[]; tab: Exclude<Tab, "requests">; requestedByGame: Map<string, HostRequest> }) {
  if (games.length === 0) {
    return (
      <Card>
        {tab === "available" ? (
          <CardSubtitle>
            No live shows are open for host requests right now. Admins schedule live games — check back soon, or watch your Invitations.
          </CardSubtitle>
        ) : tab === "upcoming" ? (
          <>
            <CardSubtitle>
              No shows assigned to you yet. You&apos;ll see games here once an admin
              approves your request or assigns you directly.
            </CardSubtitle>
            <Link
              href="/games?tab=available"
              className="mt-3 inline-block text-xs text-[var(--color-q4w-primary)]"
            >
              Browse available shows →
            </Link>
          </>
        ) : (
          <CardSubtitle>No completed shows in your history.</CardSubtitle>
        )}
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {games.map((g) => {
        const req = requestedByGame.get(g.id);
        return (
          <Link key={g.id} href={`/games/${g.id}`} className="block">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-semibold">{g.title}</div>
                    {tab === "available" && req ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-q4w-primary)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-q4w-primary)]">
                        ✓ {req.status === "approved" ? "Approved" : "Requested"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--color-q4w-muted)]">
                    {g.category ?? "—"}
                    {g.language ? ` · ${g.language.toUpperCase()}` : ""}
                  </div>
                  <div className="mt-2 text-xs text-[var(--color-q4w-muted)]">
                    {formatDateTime(g.scheduled_at ?? g.ended_at)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusChip status={g.status} />
                  {g.host_payout != null ? (
                    <div className="text-right text-[10px] text-[var(--color-q4w-muted)]">
                      payout<br />
                      <span className="text-sm font-semibold text-[var(--color-q4w-text)]">
                        {Number(g.host_payout ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ) : g.prize_pool != null ? (
                    <div className="text-right text-[10px] text-[var(--color-q4w-muted)]">
                      prize pool<br />
                      <span className="text-sm font-semibold text-[var(--color-q4w-text)]">
                        {Number(g.prize_pool ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {tab === "available" && !req ? (
                <div className="mt-3 text-[11px] text-[var(--color-q4w-primary)]">
                  Tap to apply →
                </div>
              ) : null}
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function RequestsList({ requests }: { requests: HostRequest[] }) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardSubtitle>
          You haven&apos;t applied to host any games yet. Open the Available tab to find shows.
        </CardSubtitle>
      </Card>
    );
  }
  const pending = requests.filter((r) => r.status === "pending");
  const others  = requests.filter((r) => r.status !== "pending");
  return (
    <div className="flex flex-col gap-3">
      {pending.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/games/${r.game_id}`} className="truncate text-sm font-semibold hover:underline">
                {r.games?.title ?? "Untitled game"}
              </Link>
              <div className="mt-0.5 text-xs text-[var(--color-q4w-muted)]">
                {formatDateTime(r.games?.scheduled_at)}
              </div>
              {r.host_note ? (
                <div className="mt-2 line-clamp-2 rounded-xl border border-[var(--color-q4w-border)] bg-white/5 p-2 text-[11px] text-[var(--color-q4w-text)]">
                  &quot;{r.host_note}&quot;
                </div>
              ) : null}
            </div>
            <StatusChip status={r.status} />
          </div>
          <form action={cancelRequestAction} className="mt-3">
            <input type="hidden" name="request_id" value={r.id} />
            <Button type="submit" variant="secondary">Withdraw request</Button>
          </form>
        </Card>
      ))}

      {others.length ? (
        <>
          <div className="mt-2 mb-1 px-1 text-xs uppercase tracking-wider text-[var(--color-q4w-muted)]">History</div>
          <div className="flex flex-col gap-2">
            {others.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/games/${r.game_id}`} className="min-w-0 flex-1 hover:underline">
                    <div className="truncate text-sm font-medium">{r.games?.title ?? "—"}</div>
                    <div className="text-[11px] text-[var(--color-q4w-muted)]">
                      {formatDateTime(r.games?.scheduled_at ?? r.created_at)}
                    </div>
                  </Link>
                  <StatusChip status={r.status} />
                </div>
                {r.admin_note ? (
                  <div className="mt-2 text-[11px] text-[var(--color-q4w-muted)]">
                    Admin note: {r.admin_note}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
