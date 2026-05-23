import Link from "next/link";
import { ShieldCheck, ChevronRight, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/utils";

function formatDuration(sec: number): string {
  if (!sec) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export const metadata = { title: "KYC Queue" };

const PAGE_SIZE = 25;

interface SearchParams { status?: string; page?: string }

export default async function KycPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [list, pendingC, verifiedC, rejectedC, reviewed] = await Promise.all([
    db
      .from("kyc_requests")
      .select(
        "id, user_id, doc_type, status, attempt_number, submitted_at, reviewed_at, profiles!kyc_requests_user_id_fkey(email, full_name, country)",
        { count: "exact" },
      )
      .eq("status", status)
      .order("submitted_at", { ascending: false })
      .range(from, to),
    db.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "verified"),
    db.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "rejected"),
    db.from("kyc_requests").select("submitted_at, reviewed_at, status").gte("reviewed_at", since).not("reviewed_at", "is", null),
  ]);
  const { data, count, error } = list;
  if (error) throw error;
  const reviewedRows = (reviewed.data ?? []) as Array<{ submitted_at: string; reviewed_at: string; status: string }>;
  const totalMs = reviewedRows.reduce((a, r) => a + (new Date(r.reviewed_at).getTime() - new Date(r.submitted_at).getTime()), 0);
  const avgReviewSec = reviewedRows.length ? Math.round(totalMs / 1000 / reviewedRows.length) : 0;
  const rejectionRate = reviewedRows.length ? reviewedRows.filter((r) => r.status === "rejected").length / reviewedRows.length : 0;

  const tabs: { key: string; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "verified", label: "Verified" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <>
      <PageHeader title="KYC Queue" description="Identity verification submissions awaiting decision." />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending" value={formatNumber(pendingC.count ?? 0)} icon={ShieldCheck} hint="awaiting review" />
        <StatCard label="Verified" value={formatNumber(verifiedC.count ?? 0)} icon={CheckCircle2} hint="all time" />
        <StatCard label="Rejected" value={formatNumber(rejectedC.count ?? 0)} icon={XCircle} hint={`${(rejectionRate * 100).toFixed(1)}% rejection · 30d`} />
        <StatCard label="Avg review time" value={formatDuration(avgReviewSec)} icon={Clock} hint={`${reviewedRows.length} reviewed · 30d`} />
      </div>

      <div className="mb-3 inline-flex rounded-md border p-0.5 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/kyc?status=${t.key}`}
            className={`rounded px-3 py-1 text-xs font-medium ${
              status === t.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((k) => {
                  const p = (k.profiles as unknown as { email?: string; full_name?: string; country?: string } | null) ?? null;
                  return (
                    <TableRow key={k.id}>
                      <TableCell>
                        <Link href={`/kyc/${k.id}`} className="hover:underline">
                          <div className="text-sm font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email}{p?.country ? ` · ${p.country}` : ""}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{k.doc_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm tabular-nums">{k.attempt_number}/3</TableCell>
                      <TableCell><StatusBadge value={k.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(k.submitted_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(k.reviewed_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/kyc/${k.id}`}>
                            {k.status === "pending" ? "Review" : "Open"} <ChevronRight className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/kyc" searchParams={{ status }} />
          </>
        ) : (
          <EmptyState icon={ShieldCheck} title={`No ${status} submissions`} description="The queue is currently clear." />
        )}
      </Card>
    </>
  );
}
