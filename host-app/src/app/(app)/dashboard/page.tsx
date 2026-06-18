import Link from "next/link";
import { ChevronRight, Mail, Gamepad2, Wallet, AlertCircle, Sparkles, ClipboardList, MonitorPlay, Radio } from "lucide-react";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Home — Quiz4Win Host" };

interface Host {
  id: string; name: string; application_status: string; status: string;
  total_earnings?: number | string; shows_hosted?: number;
}
interface Game { id: string; title: string; scheduled_at: string | null; status: string; host_assignment_status?: string | null }
interface Invitation { id: string; status: string; games?: Game | null }
interface Req { id: string; status: string; game_id: string }
interface LiveHost {
  id: string; name: string; avg_rating: number | null;
  live_shows: { id: string; title: string; mode: string; }[];
}

export default async function DashboardPage() {
  const [me, upcoming, available, invites, reqs, liveHostsRes] = await Promise.all([
    api<{ host: Host }>("/host/me"),
    api<{ games: Game[] }>("/host/games/upcoming"),
    api<{ games: Game[] }>("/host/games/available"),
    api<{ invitations: Invitation[] }>("/host/invitations"),
    api<{ requests: Req[] }>("/host/games/requests"),
    api<{ hosts: LiveHost[]; pagination: { total: number } }>("/public-hosts/live?limit=3"),
  ]);
  const host = me.ok ? me.data?.host : null;
  const upcomingGames = upcoming.ok ? upcoming.data?.games ?? [] : [];
  const nextGame = upcomingGames[0] ?? null;
  // Games directly assigned by an admin that the host hasn't accepted/rejected yet.
  const pendingAssignments = upcomingGames.filter((g) => g.host_assignment_status === "pending");
  const myShows = upcomingGames.filter((g) => g.host_assignment_status === "accepted");
  const pendingInvites = (invites.ok ? invites.data?.invitations ?? [] : []).filter((i) => i.status === "sent");
  // Combined "awaiting your response" count: direct-assign pending + sent invitations.
  const pendingNotifications = pendingAssignments.length + pendingInvites.length;
  const pendingReqs = (reqs.ok ? reqs.data?.requests ?? [] : []).filter((r) => r.status === "pending");
  const availableCount = available.ok ? available.data?.games?.length ?? 0 : 0;
  const liveHosts = liveHostsRes.ok ? liveHostsRes.data?.hosts ?? [] : [];
  const liveTotalCount = liveHostsRes.ok ? liveHostsRes.data?.pagination?.total ?? 0 : 0;

  return (
    <>
      <PageHeader title={host?.name ?? "Welcome"} subtitle="Your host dashboard" />

      {host && host.application_status !== "approved" ? (
        <Card className="mb-4 border border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <CardTitle className="text-amber-200">
                {host.application_status === "pending" ? "Application under review"
                  : host.application_status === "rejected" ? "Application rejected"
                  : "Account suspended"}
              </CardTitle>
            </div>
            <StatusChip status={host.application_status} />
          </CardHeader>
          <CardSubtitle>
            {host.application_status === "pending"
              ? "We'll notify you when an admin reviews your application."
              : "Some features are disabled until your account is reactivated."}
          </CardSubtitle>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/games" className="block">
          <Card>
            <Gamepad2 className="h-5 w-5 text-pink-300" />
            <div className="mt-3 text-2xl font-semibold tabular-nums">{host?.shows_hosted ?? 0}</div>
            <div className="text-[11px] text-white/45">Shows hosted</div>
          </Card>
        </Link>
        <Link href="/wallet" className="block">
          <Card>
            <Wallet className="h-5 w-5 text-teal-300" />
            <div className="mt-3 text-2xl font-semibold tabular-nums">
              {Number(host?.total_earnings ?? 0).toFixed(2)}
            </div>
            <div className="text-[11px] text-white/45">Total earnings</div>
          </Card>
        </Link>
      </div>

      {liveHosts.length > 0 ? (
        <Card className="mt-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-red-400" />
              <CardTitle>Live on the platform</CardTitle>
            </div>
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
              {liveTotalCount} live
            </span>
          </CardHeader>
          <div className="flex flex-col gap-2">
            {liveHosts.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-q4w-primary)]/15 text-xs font-bold text-[var(--color-q4w-primary)]">
                  {h.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{h.name}</div>
                  {h.live_shows[0] ? (
                    <div className="truncate text-[11px] text-[var(--color-q4w-muted)]">
                      {h.live_shows[0].title}
                    </div>
                  ) : null}
                </div>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {host?.application_status === "approved" && myShows.length > 0 ? (
        <Link href="/games?tab=upcoming" className="mt-3 block">
          <Card className="border border-emerald-500/30 bg-emerald-500/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MonitorPlay className="h-4 w-4 text-emerald-400" />
                <CardTitle className="text-emerald-200">My Shows</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                  {myShows.length} confirmed
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--color-q4w-muted)]" />
              </div>
            </CardHeader>
            <CardSubtitle>
              {myShows.length === 1
                ? "You have 1 confirmed upcoming show. Tap to view details."
                : `You have ${myShows.length} confirmed upcoming shows. Tap to view them.`}
            </CardSubtitle>
          </Card>
        </Link>
      ) : null}

      {host?.application_status === "approved" ? (
        <Link href="/games?tab=available" className="mt-3 block">
          <Card className="border-pink-500/25 bg-pink-500/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-pink-300" />
                <CardTitle>Apply for shows</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-xs text-pink-300">
                  {availableCount} open
                </span>
                <ChevronRight className="h-4 w-4 text-white/40" />
              </div>
            </CardHeader>
            <CardSubtitle>
              {availableCount === 0
                ? "No shows are open for requests right now. Check back soon."
                : availableCount === 1
                  ? "An upcoming show is open for host requests. Tap to apply."
                  : `${availableCount} upcoming shows are open for host requests. Tap to apply.`}
            </CardSubtitle>
          </Card>
        </Link>
      ) : null}

      {/* Invitations: direct-assign pending + sent host_invitations.
          The Invitations page surfaces both, so always link there. */}
      <Link href="/invitations" className="mt-3 block">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-fuchsia-300" />
              <CardTitle>Invitations</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {pendingNotifications > 0 ? (
                <span className="rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-xs font-medium text-fuchsia-300">
                  {pendingNotifications} pending
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50">
                  0 new
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-white/40" />
            </div>
          </CardHeader>
          {pendingNotifications === 0 ? (
            <CardSubtitle>No pending invitations or assignments.</CardSubtitle>
          ) : pendingAssignments.length > 0 ? (
            <CardSubtitle>
              {pendingAssignments.length === 1
                ? "You have been assigned to 1 show — tap to accept or reject."
                : `You have been assigned to ${pendingAssignments.length} shows — tap to accept or reject.`}
              {pendingInvites.length > 0 ? ` Plus ${pendingInvites.length} invitation${pendingInvites.length > 1 ? "s" : ""}.` : ""}
            </CardSubtitle>
          ) : (
            <CardSubtitle>You have {pendingInvites.length} invitation{pendingInvites.length > 1 ? "s" : ""} to review.</CardSubtitle>
          )}
        </Card>
      </Link>

      {pendingReqs.length > 0 ? (
        <Link href="/games?tab=requests" className="mt-3 block">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-teal-300" />
                <CardTitle>My applications</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-xs text-teal-300">
                  {pendingReqs.length} pending
                </span>
                <ChevronRight className="h-4 w-4 text-white/40" />
              </div>
            </CardHeader>
            <CardSubtitle>Awaiting admin review.</CardSubtitle>
          </Card>
        </Link>
      ) : null}

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Next show</CardTitle>
          <Link href="/games" className="text-xs text-white/40 hover:text-white/70 transition-colors">All</Link>
        </CardHeader>
        {nextGame ? (
          <Link href={`/games/${nextGame.id}`} className="block rounded-2xl border border-white/10 p-3 hover:bg-white/5 transition-colors">
            <div className="text-sm font-medium">{nextGame.title}</div>
            <div className="mt-1 text-xs text-[var(--color-q4w-muted)]">{formatDateTime(nextGame.scheduled_at)}</div>
            <div className="mt-2"><StatusChip status={nextGame.status} /></div>
          </Link>
        ) : (
          <CardSubtitle>You have no upcoming shows. Browse available games or wait for invitations.</CardSubtitle>
        )}
      </Card>
    </>
  );
}
