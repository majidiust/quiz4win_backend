import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import {
  acceptInvitationAction, rejectInvitationAction,
  acceptAssignmentAction, rejectAssignmentAction,
} from "./actions";

export const metadata = { title: "Invitations — Quiz4Win Host" };

interface Game {
  id: string; title: string; scheduled_at: string | null; mode?: string; language?: string | null;
  status: string; host_id?: string | null; host_assignment_status?: string | null;
}
interface Invitation {
  id: string; status: string; admin_message?: string | null; expires_at?: string | null;
  responded_at?: string | null; games?: Game | null;
}

export default async function InvitationsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  // Two assignment channels surface here: explicit host_invitations, and
  // direct admin assignments (games.host_id set, host_assignment_status='pending').
  const [invRes, upRes] = await Promise.all([
    api<{ invitations: Invitation[] }>("/host/invitations"),
    api<{ games: Game[] }>("/host/games/upcoming"),
  ]);
  const invitations = invRes.ok ? invRes.data?.invitations ?? [] : [];
  const upcoming = upRes.ok ? upRes.data?.games ?? [] : [];
  const pendingAssignments = upcoming.filter((g) => g.host_assignment_status === "pending");
  const pending = invitations.filter((i) => i.status === "sent");
  const history = invitations.filter((i) => i.status !== "sent");
  const totalPending = pending.length + pendingAssignments.length;

  return (
    <>
      <PageHeader title="Invitations" subtitle={`${totalPending} pending`} />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      {totalPending === 0 ? (
        <Card><CardSubtitle>No pending invitations or assignments right now.</CardSubtitle></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pendingAssignments.map((g) => (
            <Card key={g.id} className="border border-[var(--color-q4w-primary)]/40 bg-[var(--color-q4w-primary)]/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle>{g.title}</CardTitle>
                  <CardSubtitle>{formatDateTime(g.scheduled_at)}</CardSubtitle>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  Assigned by admin
                </span>
              </div>
              <CardSubtitle className="mt-2">
                You&apos;ve been assigned to host this show. Accept to confirm, or reject to return it to the pool.
              </CardSubtitle>
              <form action={acceptAssignmentAction} className="mt-3">
                <input type="hidden" name="game_id" value={g.id} />
                <Button type="submit">Accept</Button>
              </form>
              <form action={rejectAssignmentAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="game_id" value={g.id} />
                <Textarea name="note" placeholder="Reason for rejecting (optional)" maxLength={500} />
                <Button type="submit" variant="secondary">Reject</Button>
              </form>
            </Card>
          ))}

          {pending.map((inv) => (
            <Card key={inv.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle>{inv.games?.title ?? "Untitled game"}</CardTitle>
                  <CardSubtitle>{formatDateTime(inv.games?.scheduled_at)}</CardSubtitle>
                </div>
                <StatusChip status={inv.status} />
              </div>
              {inv.admin_message ? (
                <div className="mt-3 rounded-xl border border-[var(--color-q4w-border)] bg-white/5 p-3 text-xs text-[var(--color-q4w-text)]">
                  &quot;{inv.admin_message}&quot;
                </div>
              ) : null}
              {inv.expires_at ? (
                <div className="mt-2 text-[11px] text-[var(--color-q4w-muted)]">
                  Expires {formatDateTime(inv.expires_at)}
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <form action={acceptInvitationAction}>
                  <input type="hidden" name="id" value={inv.id} />
                  <Button type="submit">Accept</Button>
                </form>
                <form action={rejectInvitationAction}>
                  <input type="hidden" name="id" value={inv.id} />
                  <Button type="submit" variant="secondary">Reject</Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {history.length ? (
        <>
          <div className="mt-6 mb-2 px-1 text-xs uppercase tracking-wider text-[var(--color-q4w-muted)]">History</div>
          <div className="flex flex-col gap-2">
            {history.map((inv) => (
              <Card key={inv.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{inv.games?.title ?? "—"}</div>
                    <div className="text-[11px] text-[var(--color-q4w-muted)]">{formatDateTime(inv.responded_at)}</div>
                  </div>
                  <StatusChip status={inv.status} />
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
