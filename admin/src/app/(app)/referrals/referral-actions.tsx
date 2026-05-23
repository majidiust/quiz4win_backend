"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPromoCode, disablePromoCode } from "@/lib/actions/referrals";

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
