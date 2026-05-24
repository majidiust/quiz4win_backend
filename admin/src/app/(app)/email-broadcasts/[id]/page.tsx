import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Mail, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const metadata = { title: "Broadcast Details" };

export default async function BroadcastDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin"]);
  const { id } = await params;

  const db = createSupabaseAdminClient();
  const { data: b, error } = await db
    .from("email_broadcasts")
    .select(`
      *,
      admin_users ( name )
    `)
    .eq("id", id)
    .single();

  if (error || !b) notFound();

  const { data: messages } = await db
    .from("email_messages")
    .select("id, email, status, error, sent_at, opened_at")
    .eq("broadcast_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const stats = [
    { label: "Intended", value: formatNumber(b.total_count), icon: Mail },
    { label: "Successfully Sent", value: formatNumber(b.sent_count), icon: CheckCircle2, color: "text-success" },
    { label: "Failed / Error", value: formatNumber(b.error_count), icon: AlertCircle, color: "text-destructive" },
    { label: "Created By", value: b.admin_users?.name || "System", icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <Link href="/email-broadcasts" className="flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="mr-1 size-4" /> Back to broadcasts
      </Link>

      <PageHeader
        title={b.title}
        description={`Subject: ${b.subject}`}
        actions={<StatusBadge value={b.status} />}
      />

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
              <s.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${s.color || ""}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery Log (Recent 50)</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent At</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{m.email}</div>
                    {m.error && <div className="text-[10px] text-destructive">{m.error}</div>}
                  </TableCell>
                  <TableCell><StatusBadge value={m.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(m.sent_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(m.opened_at) || "-"}</TableCell>
                </TableRow>
              ))}
              {(!messages || messages.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    No messages sent yet. Broadcast may be in draft or queued.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Target Segment</div>
              <div className="text-sm capitalize">{b.target_segment.replace(/_/g, " ")}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Preheader</div>
              <div className="text-sm italic text-muted-foreground">{b.payload?.preheader}</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="mb-2 text-lg font-bold">{b.payload?.heroTitle}</div>
              <div className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: b.payload?.bodyHtml }} />
              {b.payload?.ctaLabel && (
                <div className="mt-4 inline-block rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
                  {b.payload.ctaLabel}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
