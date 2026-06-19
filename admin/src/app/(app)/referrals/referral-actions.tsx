"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPromoCode, disablePromoCode, setReferralCodeEligibility } from "@/lib/actions/referrals";

/* ------------------------------------------------------------------ */
/* Create promo code dialog                                             */
/* ------------------------------------------------------------------ */
export function CreatePromoDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  const [code, setCode] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  function reset() {
    setCode(""); setCampaignName(""); setBonusAmount(""); setMaxUses(""); setExpiresAt("");
  }

  function submit() {
    if (!code.trim() || !campaignName.trim() || !bonusAmount) {
      toast.error("Code, campaign name and bonus amount are required");
      return;
    }
    start(async () => {
      const res = await createPromoCode({
        code: code.trim(),
        campaign_name: campaignName.trim(),
        bonus_amount: parseFloat(bonusAmount),
        max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Create promo code
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create promo code</DialogTitle>
            <DialogDescription>Add a campaign-level referral code.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pc-code">Code *</Label>
                <Input id="pc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER25" maxLength={50} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pc-campaign">Campaign *</Label>
                <Input id="pc-campaign" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Summer 2025" maxLength={200} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pc-bonus">Bonus USD *</Label>
                <Input id="pc-bonus" type="number" step="0.01" min="0" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} placeholder="5.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pc-max">Max uses</Label>
                <Input id="pc-max" type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-expires">Expires at</Label>
              <Input id="pc-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Set eligibility window (inline per row)                              */
/* ------------------------------------------------------------------ */
export function SetEligibilityButton({
  code,
  currentDays,
  globalDays,
}: {
  code: string;
  currentDays: number | null;
  globalDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(String(currentDays ?? 0));
  const [pending, start] = useTransition();

  function submit() {
    const d = parseInt(days, 10);
    if (isNaN(d) || d < 0) { toast.error("Enter a non-negative integer (0 = use global default)"); return; }
    start(async () => {
      const res = await setReferralCodeEligibility(code, d);
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  const label = currentDays === null ? `Global (${globalDays}d)` : currentDays === 0 ? "∞" : `${currentDays}d`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Override eligibility window for this code"
      >
        <Clock className="size-3" />{label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Eligibility window — {code}</DialogTitle>
            <DialogDescription>
              How many days after signup the referee can apply this code.
              Enter <strong>0</strong> to use the global default ({globalDays} days).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="elig-days">Days (0 = global default)</Label>
            <Input
              id="elig-days"
              type="number"
              min="0"
              step="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder={`Global default: ${globalDays}`}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Disable button (inline per row)                                      */
/* ------------------------------------------------------------------ */
export function DisablePromoButton({ code, type }: { code: string; type: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (type !== "promo" && type !== "campaign") return null;

  function handle() {
    start(async () => {
      const res = await disablePromoCode(code);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={handle} className="h-7 text-destructive hover:text-destructive">
      <XCircle className="size-3.5" />
    </Button>
  );
}
