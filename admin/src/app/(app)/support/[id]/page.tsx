import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatRelative, initials } from "@/lib/utils";
import { ReplyBox, TicketControls } from "./ticket-actions";

export const metadata = { title: "Support ticket" };

interface ProfileShape { full_name?: string | null; email?: string | null }
interface MessageShape {
  id: string;
  sender_type: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: ticket, error }, { data: messages }, { data: admins }] = await Promise.all([
    db
      .from("support_tickets")
      .select("*, profiles!support_tickets_user_id_fkey(full_name, email)")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("support_ticket_messages")
      .select("id, sender_type, sender_id, content, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
    db
      .from("admin_users")
      .select("id, email, full_name")
      .eq("status", "active")
      .order("full_name"),
  ]);

  if (error || !ticket) notFound();

  const profile = (ticket.profiles as unknown as ProfileShape | null) ?? null;
  const adminMap = new Map((admins ?? []).map((a) => [a.id, a]));

  return (
    <>
      <PageHeader
        title={`#${ticket.ticket_number}`}
        description={ticket.subject}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/support"><ArrowLeft className="size-4" /> All tickets</Link>
            </Button>
            <TicketControls
              ticketId={id}
              currentStatus={ticket.status}
              currentAssigneeId={ticket.assigned_to}
              admins={admins ?? []}
            />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-base">Ticket info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Status"><StatusBadge value={ticket.status} /></Row>
              <Row label="Category"><span className="capitalize">{ticket.category}</span></Row>
              <Row label="Opened">{formatRelative(ticket.created_at)}</Row>
              <Row label="Updated">{formatRelative(ticket.updated_at)}</Row>
              {ticket.assigned_to ? (
                <Row label="Assigned to">
                  <span className="text-xs">{adminMap.get(ticket.assigned_to)?.email ?? "—"}</span>
                </Row>
              ) : (
                <Row label="Assigned to"><span className="text-xs text-muted-foreground">Unassigned</span></Row>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Player</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Name">{profile?.full_name ?? "—"}</Row>
              <Row label="Email">{profile?.email ?? "—"}</Row>
              <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                <Link href={`/users/${ticket.user_id}`}>Open profile</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Conversation */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Conversation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Original message */}
              <MessageBubble
                senderType="user"
                senderName={profile?.full_name ?? "Player"}
                content={ticket.description}
                time={ticket.created_at}
              />
              {/* Thread */}
              {(messages ?? []).map((m: MessageShape) => {
                const a = m.sender_type === "admin" ? adminMap.get(m.sender_id) : null;
                return (
                  <MessageBubble
                    key={m.id}
                    senderType={m.sender_type}
                    senderName={m.sender_type === "admin" ? (a?.full_name ?? a?.email ?? "Admin") : (profile?.full_name ?? "Player")}
                    content={m.content}
                    time={m.created_at}
                  />
                );
              })}
              {/* Reply box */}
              {!["resolved", "closed"].includes(ticket.status) && (
                <div className="border-t pt-4">
                  <ReplyBox ticketId={id} />
                </div>
              )}
              {["resolved", "closed"].includes(ticket.status) && (
                <p className="text-xs text-muted-foreground">This ticket is {ticket.status}. Change the status to re-open it.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function MessageBubble({ senderType, senderName, content, time }: { senderType: string; senderName: string; content: string; time: string }) {
  const isAdmin = senderType === "admin";
  return (
    <div className={`flex items-start gap-3 ${isAdmin ? "flex-row-reverse" : ""}`}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className={`text-[10px] ${isAdmin ? "bg-primary text-primary-foreground" : ""}`}>
          {isAdmin ? <Shield className="size-4" /> : <User className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`max-w-[80%] space-y-1 ${isAdmin ? "items-end" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{senderName}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(time)}</span>
        </div>
        <div className={`rounded-lg p-3 text-sm ${isAdmin ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
          {content}
        </div>
      </div>
    </div>
  );
}
