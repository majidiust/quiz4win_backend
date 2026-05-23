"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewAmlFlag } from "@/lib/actions/finance";

interface Props {
  flagId: string;
  disabled?: boolean;
}

export function AmlReview({ flagId, disabled }: Props) {
  const router = useRouter();
  const [decision, setDecision] = useState<"clear" | "escalate" | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const open = decision !== null;

  function close() {
    setDecision(null);
    setNote("");
  }

  function submit() {
    if (!decision) return;
    if (note.trim().length < 3) {
      toast.error("Review note required (min 3 characters)");
      return;
    }
    startTransition(async () => {
      const res = await reviewAmlFlag({ id: flagId, decision, note: note.trim() });
      if (res.ok) {
        toast.success(res.message);
        close();
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Dialog open={open} onOpenChange={(v) => (v ? null : close())}>
        <DialogTrigger asChild>
          <Button variant="success" size="sm" disabled={disabled || pending} onClick={() => setDecision("clear")}>
            <ShieldCheck className="size-3.5" /> Clear
          </Button>
        </DialogTrigger>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={disabled || pending} onClick={() => setDecision("escalate")}>
            <ShieldAlert className="size-3.5" /> Escalate
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "clear" ? "Clear AML flag" : "Escalate AML flag"}
            </DialogTitle>
            <DialogDescription>
              {decision === "clear"
                ? "Mark this activity as legitimate. The player will not be restricted further."
                : "Escalate for compliance review. The player's account stays restricted pending investigation."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="aml-note">Review note</Label>
            <Textarea
              id="aml-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder={
                decision === "clear"
                  ? "e.g. Confirmed source of funds via prior KYC docs."
                  : "e.g. Multiple chargebacks across geographies — refer to compliance."
              }
            />
            <p className="text-right text-xs text-muted-foreground">{note.length}/500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close} disabled={pending}>Cancel</Button>
            <Button
              variant={decision === "clear" ? "success" : "destructive"}
              size="sm"
              loading={pending}
              disabled={note.trim().length < 3}
              onClick={submit}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
