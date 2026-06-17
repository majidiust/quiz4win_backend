import Link from "next/link";
import { ChevronRight, Mail, Gamepad2, Wallet, AlertCircle, Sparkles, ClipboardList } from "lucide-react";
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

export default async function DashboardPage() {
  const [me, upcoming, available, invites, reqs] = await Promise.all([
    api<{ host: Host }>("/host/me"),
    api<{ games: Game[] }>("/host/games/upcoming"),
    api<{ games: Game[] }>("/host/games/available"),
    api<{ invitations: Invitation[] }>("/host/invitations"),
    api<{ requests: Req[] }>("/host/games/requests"),
  ]);
  const host = me.ok ? me.data?.host : null;
  const upcomingGames = upcoming.ok ? upcoming.data?.games ?? [] : [];
  const nextGame = upcomingGames[0] ?? null;
  // Games directly assigned by an admin that the host hasn't accepted/rejected yet.
  const pendingAssignments = upcomingGames.filter((g) => g.host_assignment_status === "pending");
  const pendingInvites = (invites.ok ? invites.data?.invitations ?? [] : []).filter((i) => i.status === "sent");
  // Combined "awaiting your response" count: direct-assign pending + sent invitations.
  const pendingNotifications = pendingAssignments.length + pendingInvites.length;
  const pendingReqs = (reqs.ok ? reqs.data?.requests ?? [] : []).filter((r) => r.status === "pending");
  const availableCount = available.ok ? available.data?.games?.length ?? 0 : 0;

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
            <Gamepad2 className="h-5 w-5 text-[var(--color-q4w-primary)]" />
            <div className="mt-3 text-2xl font-semibold tabular-nums">{host?.shows_hosted ?? 0}</div>
            <div className="text-[11px] text-[var(--color-q4w-muted)]">Shows hosted</div>
          </Card>
        </Link>
        <Link href="/wallet" className="block">
          <Card>
            <Wallet className="h-5 w-5 text-[var(--color-q4w-primary)]" />
            <div className="mt-3 text-2xl font-semibold tabular-nums">
              {Number(host?.total_earnings ?? 0).toFixed(2)}
            </div>
            <div className="text-[11px] text-[var(--color-q4w-muted)]">Total earnings</div>
          </Card>
        </Link>
      </div>

      {host?.application_status === "approved" ? (
        <Link href="/games?tab=available" className="mt-3 block">
          <Card className="border border-[var(--color-q4w-primary)]/30 bg-[var(--color-q4w-primary)]/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--color-q4w-primary)]" />
                <CardTitle>Apply for shows</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--color-q4w-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-q4w-primary)]">
                  {availableCount} open
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--color-q4w-muted)]" />
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
              <Mail className="h-4 w-4 text-[var(--color-q4w-primary)]" />
              <CardTitle>Invitations</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {pendingNotifications > 0 ? (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
                  {pendingNotifications} pending
                </span>
              ) : (
                <span className="rounded-full bg-[var(--color-q4w-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-q4w-primary)]">
                  0 new
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-[var(--color-q4w-muted)]" />
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
                <ClipboardList className="h-4 w-4 text-[var(--color-q4w-primary)]" />
                <CardTitle>My applications</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--color-q4w-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-q4w-primary)]">
                  {pendingReqs.length} pending
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--color-q4w-muted)]" />
              </div>
            </CardHeader>
            <CardSubtitle>Awaiting admin review.</CardSubtitle>
          </Card>
        </Link>
      ) : null}

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Next show</CardTitle>
          <Link href="/games" className="text-xs text-[var(--color-q4w-muted)]">All</Link>
        </CardHeader>
        {nextGame ? (
          <Link href={`/games/${nextGame.id}`} className="block rounded-xl border border-[var(--color-q4w-border)] p-3">
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
