"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { replyToTicket, assignTicket, updateTicketStatus } from "@/lib/actions/support";

interface AdminUser { id: string; email: string; full_name?: string | null }

interface Props {
  ticketId: string;
  currentStatus: string;
  currentAssigneeId?: string | null;
  admins: AdminUser[];
}

/* ------------------------------------------------------------------ */
/* Reply box                                                            */
/* ------------------------------------------------------------------ */
export function ReplyBox({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (!content.trim()) { toast.error("Reply cannot be empty"); return; }
    start(async () => {
      const res = await replyToTicket({ ticketId, content: content.trim() });
      if (res.ok) { toast.success(res.message); setContent(""); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="reply-box">Your reply</Label>
      <Textarea
        id="reply-box"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        maxLength={5000}
        placeholder="Type your response to the player…"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{content.length}/5000</p>
        <Button size="sm" loading={pending} onClick={submit}>
          <Send className="size-3.5" /> Send reply
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status + Assign controls                                             */
/* ------------------------------------------------------------------ */
export function TicketControls({ ticketId, currentStatus, currentAssigneeId, admins }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function changeStatus(status: string) {
    start(async () => {
      const res = await updateTicketStatus({ ticketId, status: status as "open" | "in_progress" | "resolved" | "closed" });
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  function changeAssignee(adminId: string) {
    start(async () => {
      const res = await assignTicket({ ticketId, assigneeId: adminId === "unassigned" ? null : adminId });
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  const statuses = ["open", "in_progress", "resolved", "closed"];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Status</Label>
        <Select value={currentStatus} onValueChange={changeStatus} disabled={pending}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {admins.length > 0 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">
            <UserCheck className="inline size-3 mr-1" />Assign
          </Label>
          <Select value={currentAssigneeId ?? "unassigned"} onValueChange={changeAssignee} disabled={pending}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned" className="text-xs text-muted-foreground">Unassigned</SelectItem>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  {a.full_name ?? a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
