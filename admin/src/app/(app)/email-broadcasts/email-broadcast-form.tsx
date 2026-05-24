"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Save, Send } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createEmailBroadcast } from "@/lib/actions/email-broadcasts";

const broadcastSchema = z.object({
  title: z.string().min(1, "Internal title is required"),
  subject: z.string().min(1, "Email subject is required"),
  type: z.enum(["system", "promotion"]),
  target_segment: z.enum([
    "all", "verified_only", "non_verified_only", "active_players_30d", "inactive_players_30d", "specific_ids"
  ]),
  preheader: z.string().min(1, "Inbox teaser is required"),
  heroTitle: z.string().min(1, "Hero title is required"),
  heroSubtitle: z.string().optional(),
  bodyHtml: z.string().min(1, "Body content is required"),
  ctaLabel: z.string().optional(),
  ctaUrl: z.string().url().optional().or(z.literal("")),
  ctaVariant: z.enum(["primary", "gold", "win", "dark"]),
  ctaNote: z.string().optional(),
});

type BroadcastValues = z.infer<typeof broadcastSchema>;

export function EmailBroadcastForm({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const form = useForm<BroadcastValues>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: initialData || {
      title: "",
      subject: "",
      type: "promotion",
      target_segment: "all",
      preheader: "",
      heroTitle: "",
      heroSubtitle: "",
      bodyHtml: "",
      ctaLabel: "",
      ctaUrl: "",
      ctaVariant: "primary",
      ctaNote: "",
    },
  });

  async function onSubmit(values: BroadcastValues, publish = false) {
    start(async () => {
      const res = await createEmailBroadcast({
        ...values,
        status: publish ? "queued" : "draft",
      });
      if (res.ok) {
        toast.success(res.message);
        router.push("/email-broadcasts");
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Card>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <CardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2 col-span-1">
              <Label>Internal Title *</Label>
              <Input {...form.register("title")} placeholder="e.g. June Newsletter 2026" />
              {form.formState.errors.title && <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) => form.setValue("type", v as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System (ignore opt-out)</SelectItem>
                  <SelectItem value="promotion">Promotion (respect opt-out)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Segment *</Label>
              <Select
                value={form.watch("target_segment")}
                onValueChange={(v) => form.setValue("target_segment", v as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Players</SelectItem>
                  <SelectItem value="verified_only">Verified Only (KYC)</SelectItem>
                  <SelectItem value="non_verified_only">Non-Verified Only</SelectItem>
                  <SelectItem value="active_players_30d">Active (last 30 days)</SelectItem>
                  <SelectItem value="inactive_players_30d">Inactive (30+ days)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Email Subject *</Label>
            <Input {...form.register("subject")} placeholder="The one they see in their inbox" />
            {form.formState.errors.subject && <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Inbox Teaser (Preheader) *</Label>
            <Input {...form.register("preheader")} placeholder="Short preview text (approx 80 chars)" />
            {form.formState.errors.preheader && <p className="text-xs text-destructive">{form.formState.errors.preheader.message}</p>}
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">Brand Shell Content</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Hero Title *</Label>
                <Input {...form.register("heroTitle")} placeholder="Big headline at the top" />
              </div>
              <div className="space-y-2">
                <Label>Hero Subtitle</Label>
                <Input {...form.register("heroSubtitle")} placeholder="Small text under headline" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Body Content (HTML) *</Label>
              <Textarea
                {...form.register("bodyHtml")}
                rows={6}
                placeholder="<p>Main message goes here...</p>"
              />
              <p className="text-[10px] text-muted-foreground">Use &lt;p&gt;, &lt;strong&gt;, &lt;ul&gt; tags for styling.</p>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">Call to Action</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Button Label</Label>
                <Input {...form.register("ctaLabel")} placeholder="e.g. Play Now" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Button URL</Label>
                <Input {...form.register("ctaUrl")} placeholder="https://app.quiz4win.com/..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Button Variant</Label>
                <Select
                  value={form.watch("ctaVariant")}
                  onValueChange={(v) => form.setValue("ctaVariant", v as any)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Indigo (Primary)</SelectItem>
                    <SelectItem value="gold">Gold (Promo)</SelectItem>
                    <SelectItem value="win">Green (Prize)</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Note (under button)</Label>
                <Input {...form.register("ctaNote")} placeholder="e.g. Valid until midnight" />
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between border-t bg-muted/50 py-4">
          <Button variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => form.handleSubmit((v) => onSubmit(v, false))()}
              disabled={pending}
            >
              <Save className="mr-2 size-4" /> Save Draft
            </Button>
            <Button
              onClick={() => form.handleSubmit((v) => onSubmit(v, true))()}
              disabled={pending}
            >
              <Send className="mr-2 size-4" /> Queue for Sending
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
