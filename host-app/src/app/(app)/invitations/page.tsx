import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { acceptInvitationAction, rejectInvitationAction } from "./actions";

export const metadata = { title: "Invitations — Quiz4Win Host" };

interface Game { id: string; title: string; scheduled_at: string | null; mode?: string; language?: string | null; status: string }
interface Invitation {
  id: string; status: string; admin_message?: string | null; expires_at?: string | null;
  responded_at?: string | null; games?: Game | null;
}

export default async function InvitationsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const r = await api<{ invitations: Invitation[] }>("/host/invitations");
  const invitations = r.ok ? r.data?.invitations ?? [] : [];
  const pending = invitations.filter((i) => i.status === "sent");
  const history = invitations.filter((i) => i.status !== "sent");

  return (
    <>
      <PageHeader title="Invitations" subtitle={`${pending.length} pending`} />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      {pending.length === 0 ? (
        <Card><CardSubtitle>No pending invitations right now.</CardSubtitle></Card>
      ) : (
        <div className="flex flex-col gap-3">
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
