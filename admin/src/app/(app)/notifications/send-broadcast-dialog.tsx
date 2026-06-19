"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { sendBroadcast } from "@/lib/actions/broadcasts";

export function SendBroadcastDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"system" | "promotion">("system");
  const [segmentStatus, setSegmentStatus] = useState("all");
  const [scheduledAt, setScheduledAt] = useState("");

  function reset() {
    setTitle(""); setBody(""); setType("system");
    setSegmentStatus("all"); setScheduledAt("");
  }

  function submit() {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required");
      return;
    }
    start(async () => {
      const res = await sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        type,
        segment_status: segmentStatus && segmentStatus !== "all" ? segmentStatus : undefined,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
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
        <Megaphone className="size-4" /> Send broadcast
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send broadcast</DialogTitle>
            <DialogDescription>
              Push an in-app notification to all players or a segment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-title">Title *</Label>
              <Input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. New game night tonight!" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bc-body">Message *</Label>
              <Textarea id="bc-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} placeholder="Body text shown to players…" />
              <p className="text-xs text-muted-foreground">{body.length}/1000</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as "system" | "promotion")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="promotion">Promotion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Segment — user status</Label>
                <Select value={segmentStatus} onValueChange={setSegmentStatus}>
                  <SelectTrigger><SelectValue placeholder="All users" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    <SelectItem value="active">Active only</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bc-schedule">Schedule for (optional)</Label>
              <Input id="bc-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave blank to send immediately.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>
              <Megaphone className="size-4" />
              {scheduledAt ? "Schedule" : "Send now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
