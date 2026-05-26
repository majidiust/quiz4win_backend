"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, XCircle, ChevronRight, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startGame, endGame, cancelGame, advanceQuestion, removeParticipant, uploadGameAsset } from "@/lib/actions/games";

interface Props { gameId: string; status: string }

/* ------------------------------------------------------------------ */
/* Lifecycle buttons                                                    */
/* ------------------------------------------------------------------ */
export function GameLifecycleActions({ gameId, status }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {["upcoming", "open"].includes(status) && (
        <Button size="sm" onClick={() => run(() => startGame(gameId))} loading={pending}>
          <Play className="size-3.5" /> Start
        </Button>
      )}
      {status === "live" && (
        <>
          <Button size="sm" variant="outline" onClick={() => run(() => advanceQuestion(gameId))} loading={pending}>
            <ChevronRight className="size-3.5" /> Next question
          </Button>
          <Button size="sm" variant="destructive" onClick={() => run(() => endGame(gameId))} loading={pending}>
            <Square className="size-3.5" /> End game
          </Button>
        </>
      )}
      {!["completed", "cancelled"].includes(status) && (
        <CancelDialog gameId={gameId} pending={pending} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cancel dialog                                                        */
/* ------------------------------------------------------------------ */
function CancelDialog({ gameId, pending }: { gameId: string; pending: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, startCancel] = useTransition();

  function submit() {
    startCancel(async () => {
      const res = await cancelGame({ id: gameId, reason: reason.trim() });
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          <XCircle className="size-3.5" /> Cancel game
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel game</DialogTitle>
          <DialogDescription>The game will be cancelled. Entry fees may need to be refunded separately.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            rows={3} maxLength={500} placeholder="e.g. Technical issue during live session." />
          <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={cancelling}>Cancel</Button>
          <Button variant="destructive" size="sm" loading={cancelling}
            disabled={reason.trim().length < 3} onClick={submit}>Confirm cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Remove participant button (used in participants table)               */
/* ------------------------------------------------------------------ */
export function RemoveParticipantButton({ gameId, userId, name }: { gameId: string; userId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      const res = await removeParticipant(gameId, userId);
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove participant</DialogTitle>
          <DialogDescription>Remove <strong>{name}</strong> from this game?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button variant="destructive" size="sm" loading={pending} onClick={confirm}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Asset Upload Button                                                   */
/* ------------------------------------------------------------------ */
type AssetField = "icon" | "thumbnail_url" | "host_avatar_url";

export function AssetUploadButton({
  gameId, field, label, currentUrl,
}: { gameId: string; field: AssetField; label: string; currentUrl?: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    start(async () => {
      const res = await uploadGameAsset(gameId, field, formData);
      if (res.ok) { toast.success(`${label} updated`); router.refresh(); }
      else toast.error(res.message);
    });
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-1.5">
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt={label} className="h-16 w-16 rounded-md border object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">None</div>
      )}
      <Button size="sm" variant="outline" loading={pending} onClick={() => inputRef.current?.click()}>
        <Upload className="size-3.5" /> {currentUrl ? "Change" : "Upload"}
      </Button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={handleFile} />
    </div>
  );
}
