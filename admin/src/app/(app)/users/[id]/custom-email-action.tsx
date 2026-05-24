"use client";

import { useState, useTransition } from "react";
import { MailPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendCustomEmail } from "@/lib/actions/auth-users";

interface Props {
  userId: string;
  userEmail: string;
}

export function CustomEmailAction({ userId, userEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [ctaVariant, setCtaVariant] = useState<"primary" | "gold" | "win" | "dark">("primary");

  function submit() {
    if (!subject) return toast.error("Subject is required");
    if (!heroTitle) return toast.error("Hero title is required");
    if (!bodyHtml) return toast.error("Body HTML is required");

    startTransition(async () => {
      const res = await sendCustomEmail({
        id: userId,
        subject,
        heroTitle,
        heroSubtitle: heroSubtitle || undefined,
        bodyHtml,
        ctaLabel: ctaLabel || undefined,
        ctaUrl: ctaUrl || undefined,
        ctaVariant,
      });

      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        // Clear form
        setSubject("");
        setHeroTitle("");
        setHeroSubtitle("");
        setBodyHtml("");
        setCtaLabel("");
        setCtaUrl("");
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MailPlus className="size-3.5" /> Send email
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send custom email</DialogTitle>
          <DialogDescription>
            The email will be sent to <span className="font-mono text-foreground">{userEmail}</span> using the premium brand shell.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 md:grid-cols-2">
          <div className="space-y-4 md:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject line (Inbox preview)</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. You have a special gift waiting for you!"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="heroTitle">Hero Title (Headline)</Label>
            <Input
              id="heroTitle"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="e.g. Congratulations!"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="heroSubtitle">Hero Subtitle (Optional)</Label>
            <Input
              id="heroSubtitle"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="e.g. You've earned a loyalty bonus."
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="bodyHtml">Body (HTML supported)</Label>
            <Textarea
              id="bodyHtml"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder="<p>Main message content...</p>"
              rows={5}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ctaLabel">CTA Label (Optional)</Label>
            <Input
              id="ctaLabel"
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder="e.g. Claim Reward"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ctaUrl">CTA URL (Optional)</Label>
            <Input
              id="ctaUrl"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://app.quiz4win.com/..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>CTA Variant</Label>
            <Select value={ctaVariant} onValueChange={(v) => setCtaVariant(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary (Indigo)</SelectItem>
                <SelectItem value="gold">Gold (Vouchers)</SelectItem>
                <SelectItem value="win">Win (Green)</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" loading={pending} onClick={submit}>
            Dispatch Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
