"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateVoucher } from "@/lib/actions/vouchers";

interface VoucherRow {
  id: string;
  name: string;
  description?: string | null;
  reward_description: string;
  display_text: string;
  reward_type?: string | null;
  reward_value?: number | string | null;
  max_redemptions?: number | null;
  per_user_limit?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  kyc_required: boolean;
  is_case_sensitive: boolean;
  partner_name?: string | null;
  partner_url?: string | null;
}

function toDatetimeLocal(val?: string | null) {
  if (!val) return "";
  try { return new Date(val).toISOString().slice(0, 16); } catch { return ""; }
}

export function VoucherEditForm({ voucher }: { voucher: VoucherRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(voucher.name ?? "");
  const [description, setDescription] = useState(voucher.description ?? "");
  const [rewardType, setRewardType] = useState(voucher.reward_type ?? "none");
  const [rewardValue, setRewardValue] = useState(voucher.reward_value ? String(voucher.reward_value) : "");
  const [rewardDescription, setRewardDescription] = useState(voucher.reward_description ?? "");
  const [displayText, setDisplayText] = useState(voucher.display_text ?? "");
  const [maxRedemptions, setMaxRedemptions] = useState(voucher.max_redemptions ? String(voucher.max_redemptions) : "");
  const [validFrom, setValidFrom] = useState(toDatetimeLocal(voucher.valid_from));
  const [validUntil, setValidUntil] = useState(toDatetimeLocal(voucher.valid_until));
  const [kycRequired, setKycRequired] = useState(voucher.kyc_required);
  const [caseSensitive, setCaseSensitive] = useState(voucher.is_case_sensitive);
  const [partnerName, setPartnerName] = useState(voucher.partner_name ?? "");
  const [partnerUrl, setPartnerUrl] = useState(voucher.partner_url ?? "");

  function save() {
    if (!name.trim() || !rewardDescription.trim() || !displayText.trim()) {
      toast.error("Name, reward description and display text are required");
      return;
    }
    start(async () => {
      const res = await updateVoucher({
        id: voucher.id,
        name: name.trim(),
        description: description.trim() || undefined,
        reward_type: rewardType && rewardType !== "none" ? rewardType as "wallet_credit" | "free_entry" | "discount" : undefined,
        reward_value: rewardValue ? parseFloat(rewardValue) : undefined,
        reward_description: rewardDescription.trim(),
        display_text: displayText.trim(),
        max_redemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : undefined,
        valid_from: validFrom ? new Date(validFrom).toISOString() : undefined,
        valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
        kyc_required: kycRequired,
        is_case_sensitive: caseSensitive,
        partner_name: partnerName.trim() || undefined,
        partner_url: partnerUrl.trim() || undefined,
      });
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ve-name">Name *</Label>
          <Input id="ve-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
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
      <div className="space-y-1.5">
        <Label htmlFor="ve-desc">Description</Label>
        <Textarea id="ve-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ve-rval">Reward value (USD)</Label>
          <Input id="ve-rval" type="number" step="0.01" min="0" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ve-maxr">Max redemptions</Label>
          <Input id="ve-maxr" type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ve-rdesc">Reward description *</Label>
        <Input id="ve-rdesc" value={rewardDescription} onChange={(e) => setRewardDescription(e.target.value)} maxLength={500} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ve-dtext">Display text *</Label>
        <Input id="ve-dtext" value={displayText} onChange={(e) => setDisplayText(e.target.value)} maxLength={500} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ve-vfrom">Valid from</Label>
          <Input id="ve-vfrom" type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ve-vuntil">Valid until</Label>
          <Input id="ve-vuntil" type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ve-pname">Partner name</Label>
          <Input id="ve-pname" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ve-purl">Partner URL</Label>
          <Input id="ve-purl" value={partnerUrl} onChange={(e) => setPartnerUrl(e.target.value)} placeholder="https://…" />
        </div>
      </div>
      <div className="flex gap-4">
        <div className="flex items-center gap-3 rounded-md border px-3 py-2">
          <Switch id="ve-kyc" checked={kycRequired} onCheckedChange={setKycRequired} />
          <Label htmlFor="ve-kyc">KYC required</Label>
        </div>
        <div className="flex items-center gap-3 rounded-md border px-3 py-2">
          <Switch id="ve-case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
          <Label htmlFor="ve-case">Case sensitive</Label>
        </div>
      </div>
      <Button size="sm" loading={pending} onClick={save}>Save changes</Button>
    </div>
  );
}
