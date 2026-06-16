"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Pause, Play, Send, Plus, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  setHostStatus, reviewHostFile, reviewHostRequest, sendHostInvitation,
  cancelHostInvitation, createHostEarning, approveHostEarning, cancelHostEarning,
  reviewHostPaymentMethod, type ActionResult,
} from "@/lib/actions/hosts";

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "success" | "warning";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  reasonRequired?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<ActionResult>;
}

/**
 * Single confirmation dialog primitive that backs every approve/reject/cancel/
 * verify-style action on the host page. Optional `reason` textarea is shown
 * when `reasonRequired` is true and validated as non-empty.
 */
function ConfirmDialog({
  trigger, title, description, confirmLabel, confirmVariant = "default",
  reasonRequired, reasonLabel = "Reason", onConfirm,
}: ConfirmDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function handle() {
    if (reasonRequired && !reason.trim()) {
      toast.error(`${reasonLabel} is required`);
      return;
    }
    start(async () => {
      const res = await onConfirm(reason.trim());
      if (res.ok) {
        toast.success(res.message);
        setOpen(false); setReason("");
        router.refresh();
      } else { toast.error(res.message); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">
            {reasonLabel}
            {reasonRequired ? <span className="text-destructive"> *</span> : <span className="text-muted-foreground"> (optional)</span>}
          </Label>
          <Textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button variant={confirmVariant} size="sm" onClick={handle} loading={pending}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 1. Host-status actions (approve/reject/suspend/reactivate) ─────────────

export function HostStatusActions({ hostId, currentStatus }: { hostId: string; currentStatus: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmDialog
        trigger={<Button variant="success" size="sm" disabled={currentStatus === "approved"}><Check className="size-3.5" /> Approve</Button>}
        title="Approve host?" description="The host will be allowed to request games and accept invitations."
        confirmLabel="Approve" confirmVariant="success"
        onConfirm={(reason) => setHostStatus({ hostId, action: "approve", reason: reason || null })}
      />
      <ConfirmDialog
        trigger={<Button variant="destructive" size="sm" disabled={currentStatus === "rejected"}><X className="size-3.5" /> Reject</Button>}
        title="Reject host application?" description="The host can re-apply with a corrected profile."
        confirmLabel="Reject" confirmVariant="destructive" reasonRequired reasonLabel="Reason"
        onConfirm={(reason) => setHostStatus({ hostId, action: "reject", reason })}
      />
      <ConfirmDialog
        trigger={<Button variant="warning" size="sm" disabled={currentStatus === "suspended"}><Pause className="size-3.5" /> Suspend</Button>}
        title="Suspend host?" description="The host will lose access to game requests and stream-go-live."
        confirmLabel="Suspend" confirmVariant="warning" reasonRequired reasonLabel="Reason"
        onConfirm={(reason) => setHostStatus({ hostId, action: "suspend", reason })}
      />
      {currentStatus === "suspended" ? (
        <ConfirmDialog
          trigger={<Button variant="outline" size="sm"><Play className="size-3.5" /> Reactivate</Button>}
          title="Reactivate host?" description="Access is restored immediately."
          confirmLabel="Reactivate"
          onConfirm={() => setHostStatus({ hostId, action: "reactivate", reason: null })}
        />
      ) : null}
    </div>
  );
}

// ─── 2. File review (approve / reject) ──────────────────────────────────────

export function FileActions({ fileId, status }: { fileId: string; status: string }) {
  if (status !== "pending") return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="inline-flex items-center gap-1.5">
      <ConfirmDialog
        trigger={<Button variant="success" size="sm"><Check className="size-3.5" /> Approve</Button>}
        title="Approve file?" confirmLabel="Approve" confirmVariant="success"
        onConfirm={(reason) => reviewHostFile({ fileId, action: "approve", reason: reason || null })}
      />
      <ConfirmDialog
        trigger={<Button variant="destructive" size="sm"><X className="size-3.5" /> Reject</Button>}
        title="Reject file?" confirmLabel="Reject" confirmVariant="destructive" reasonRequired
        onConfirm={(reason) => reviewHostFile({ fileId, action: "reject", reason })}
      />
    </div>
  );
}

// ─── 3. Game-request review (approve / reject) ──────────────────────────────

export function RequestActions({ requestId, status }: { requestId: string; status: string }) {
  if (status !== "pending") return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="inline-flex items-center gap-1.5">
      <ConfirmDialog
        trigger={<Button variant="success" size="sm"><Check className="size-3.5" /> Approve</Button>}
        title="Approve request?" description="The host will be assigned to this game. Other pending requests and invitations for the same game are auto-closed."
        confirmLabel="Approve & assign" confirmVariant="success"
        reasonLabel="Admin note (optional)"
        onConfirm={(reason) => reviewHostRequest({ requestId, action: "approve", adminNote: reason || null })}
      />
      <ConfirmDialog
        trigger={<Button variant="destructive" size="sm"><X className="size-3.5" /> Reject</Button>}
        title="Reject request?" confirmLabel="Reject" confirmVariant="destructive"
        reasonRequired reasonLabel="Reason"
        onConfirm={(reason) => reviewHostRequest({ requestId, action: "reject", adminNote: reason })}
      />
    </div>
  );
}

// ─── 4. Invitation cancel (admin can only cancel sent invitations) ──────────

export function InvitationActions({ invitationId, status }: { invitationId: string; status: string }) {
  if (status !== "sent") return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <ConfirmDialog
      trigger={<Button variant="outline" size="sm"><Trash2 className="size-3.5" /> Cancel</Button>}
      title="Cancel invitation?" description="The host will no longer see this invitation as actionable."
      confirmLabel="Cancel invitation" confirmVariant="destructive"
      onConfirm={() => cancelHostInvitation({ invitationId })}
    />
  );
}

// ─── 5. Earning approve / cancel ────────────────────────────────────────────

export function EarningActions({ earningId, status }: { earningId: string; status: string }) {
  if (status !== "pending") return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="inline-flex items-center gap-1.5">
      <ConfirmDialog
        trigger={<Button variant="success" size="sm"><Check className="size-3.5" /> Approve</Button>}
        title="Approve earning?"
        description="This will atomically credit the host's wallet and append a host_earning transaction. The action cannot be reversed (R-05)."
        confirmLabel="Approve & credit" confirmVariant="success"
        onConfirm={() => approveHostEarning({ earningId })}
      />
      <ConfirmDialog
        trigger={<Button variant="destructive" size="sm"><X className="size-3.5" /> Cancel</Button>}
        title="Cancel pending earning?" confirmLabel="Cancel earning" confirmVariant="destructive"
        reasonRequired reasonLabel="Reason"
        onConfirm={(reason) => cancelHostEarning({ earningId, reason })}
      />
    </div>
  );
}

// ─── 6. Payment-method verify / reject ──────────────────────────────────────

export function PaymentMethodActions({ methodId, status }: { methodId: string; status: string }) {
  if (status !== "pending_verification") return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="inline-flex items-center gap-1.5">
      <ConfirmDialog
        trigger={<Button variant="success" size="sm"><ShieldCheck className="size-3.5" /> Verify</Button>}
        title="Verify payout method?" description="The method becomes usable for the host's withdrawals."
        confirmLabel="Verify" confirmVariant="success"
        onConfirm={() => reviewHostPaymentMethod({ methodId, action: "verify", reason: null })}
      />
      <ConfirmDialog
        trigger={<Button variant="destructive" size="sm"><X className="size-3.5" /> Reject</Button>}
        title="Reject payout method?" confirmLabel="Reject" confirmVariant="destructive"
        reasonRequired reasonLabel="Reason"
        onConfirm={(reason) => reviewHostPaymentMethod({ methodId, action: "reject", reason })}
      />
    </div>
  );
}

// ─── 7. Send invitation (custom form: pick from available games) ────────────

export function InvitationSendButton({
  hostId, availableGames,
}: { hostId: string; availableGames: { id: string; title: string; scheduled_at: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, start] = useTransition();

  function handle() {
    if (!gameId) { toast.error("Pick a game"); return; }
    start(async () => {
      const res = await sendHostInvitation({
        hostId, gameId,
        message: message.trim() || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false); setGameId(""); setMessage(""); setExpiresAt("");
        router.refresh();
      } else { toast.error(res.message); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!availableGames.length}>
          <Send className="size-3.5" /> Send invitation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send invitation</DialogTitle>
          <DialogDescription>Pick an unassigned upcoming live game. The host receives an in-app notification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="game">Game</Label>
            <select id="game" value={gameId} onChange={(e) => setGameId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
              <option value="">— select —</option>
              {availableGames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}{g.scheduled_at ? ` — ${new Date(g.scheduled_at).toLocaleString()}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="msg">Message (optional)</Label>
            <Textarea id="msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp">Expires at (optional)</Label>
            <Input id="exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={handle} loading={pending}>Send invitation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 8. Create pending earning (custom form: game + amount + note) ──────────

export function EarningCreateButton({
  hostId, hostedGames,
}: { hostId: string; hostedGames: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function handle() {
    const n = Number(amount);
    if (!gameId) { toast.error("Pick a game"); return; }
    if (!Number.isFinite(n) || n < 0) { toast.error("Amount must be ≥ 0"); return; }
    start(async () => {
      const res = await createHostEarning({ hostId, gameId, amount: n, currency, note: note.trim() || null });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false); setGameId(""); setAmount(""); setCurrency("USD"); setNote("");
        router.refresh();
      } else { toast.error(res.message); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="size-3.5" /> Record earning</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record pending earning</DialogTitle>
          <DialogDescription>Creates a pending host_earnings row. Wallet is credited only when you Approve it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ear-game">Game</Label>
            <select id="ear-game" value={gameId} onChange={(e) => setGameId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
              <option value="">— select —</option>
              {hostedGames.length ? hostedGames.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              )) : <option disabled>(no accepted invitations)</option>}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur">Currency</Label>
              <Input id="cur" maxLength={8} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt">Note (optional)</Label>
            <Textarea id="nt" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={handle} loading={pending}>Create pending earning</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
