import Link from "next/link";
import { Card, CardSubtitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Games — Quiz4Win Host" };

type Tab = "available" | "upcoming" | "history";
interface Game {
  id: string; title: string; mode?: string; category?: string | null; language?: string | null;
  scheduled_at: string | null; ended_at?: string | null;
  prize_pool?: number | string | null; host_payout?: number | string | null;
  status: string;
}

export default async function GamesPage({
  searchParams,
}: { searchParams: Promise<{ tab?: Tab }> }) {
  const sp = await searchParams;
  const tab: Tab = (["available", "upcoming", "history"] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : "available";
  const path = tab === "available" ? "/host/games/available"
    : tab === "upcoming" ? "/host/games/upcoming" : "/host/games/history";
  const r = await api<{ games: Game[] }>(path);
  const games = r.ok ? r.data?.games ?? [] : [];

  return (
    <>
      <PageHeader title="Games" subtitle="Browse, request, manage." />

      <div className="glass mb-4 inline-flex w-full rounded-full p-1">
        {(["available", "upcoming", "history"] as const).map((t) => (
          <Link
            key={t}
            href={`/games?tab=${t}`}
            className={`flex-1 rounded-full px-3 py-2 text-center text-xs font-medium capitalize ${
              tab === t ? "bg-[var(--color-q4w-primary)] text-white" : "text-[var(--color-q4w-muted)]"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {games.length === 0 ? (
          <Card>
            <CardSubtitle>
              {tab === "available" ? "No games are currently open for host requests."
                : tab === "upcoming" ? "You have no upcoming shows yet."
                : "No completed shows in your history."}
            </CardSubtitle>
          </Card>
        ) : games.map((g) => (
          <Link key={g.id} href={`/games/${g.id}`} className="block">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{g.title}</div>
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
                  ) : null}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
