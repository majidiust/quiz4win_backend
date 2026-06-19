"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createVoucher } from "@/lib/actions/vouchers";

export function CreateVoucherDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("promo");
  const [rewardType, setRewardType] = useState("none");
  const [rewardValue, setRewardValue] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [kycRequired, setKycRequired] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  function reset() {
    setCode(""); setName(""); setDescription(""); setType("promo");
    setRewardType("none"); setRewardValue(""); setRewardDescription("");
    setDisplayText(""); setMaxRedemptions("");
    setValidFrom(""); setValidUntil("");
    setKycRequired(false); setCaseSensitive(false);
  }

  function submit() {
    if (!code.trim() || !name.trim() || !rewardDescription.trim() || !displayText.trim()) {
      toast.error("Code, name, reward description and display text are required");
      return;
    }
    start(async () => {
      const res = await createVoucher({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        type: type as "promo" | "referral" | "partner" | "free_entry" | "reward",
        reward_type: rewardType && rewardType !== "none" ? rewardType as "wallet_credit" | "free_entry" | "discount" : undefined,
        reward_value: rewardValue ? parseFloat(rewardValue) : undefined,
        reward_description: rewardDescription.trim(),
        display_text: displayText.trim(),
        usage_type: "multi_user_single_use",
        max_redemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : undefined,
        valid_from: validFrom ? new Date(validFrom).toISOString() : undefined,
        valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
        kyc_required: kycRequired,
        is_case_sensitive: caseSensitive,
      });
      if (res.ok) { toast.success(res.message); setOpen(false); reset(); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New voucher
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create voucher</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cv-code">Code *</Label>
                <Input id="cv-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER25" maxLength={50} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cv-name">Name *</Label>
                <Input id="cv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer promo" maxLength={200} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cv-desc">Description</Label>
              <Textarea id="cv-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["promo", "referral", "partner", "free_entry", "reward"].map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reward type</Label>
                <Select value={rewardType} onValueChange={setRewardType}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {["wallet_credit", "free_entry", "discount"].map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cv-rval">Reward value (USD)</Label>
                <Input id="cv-rval" type="number" step="0.01" min="0" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cv-maxr">Max redemptions</Label>
                <Input id="cv-maxr" type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cv-rdesc">Reward description *</Label>
              <Input id="cv-rdesc" value={rewardDescription} onChange={(e) => setRewardDescription(e.target.value)} placeholder="Get $5 wallet credit" maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-dtext">Display text *</Label>
              <Input id="cv-dtext" value={displayText} onChange={(e) => setDisplayText(e.target.value)} placeholder="Shown to users on redemption" maxLength={500} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cv-vfrom">Valid from</Label>
                <Input id="cv-vfrom" type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cv-vuntil">Valid until</Label>
                <Input id="cv-vuntil" type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch id="cv-kyc" checked={kycRequired} onCheckedChange={setKycRequired} />
                <Label htmlFor="cv-kyc">KYC required</Label>
              </div>
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch id="cv-case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
                <Label htmlFor="cv-case">Case sensitive</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>Create voucher</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
