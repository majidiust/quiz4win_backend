import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

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
  const { data, count, error } = await db
    .from("kyc_requests")
    .select(
      "id, user_id, doc_type, status, attempt_number, submitted_at, reviewed_at, profiles!kyc_requests_user_id_fkey(email, full_name, country)",
      { count: "exact" },
    )
    .eq("status", status)
    .order("submitted_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  const tabs: { key: string; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "verified", label: "Verified" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <>
      <PageHeader title="KYC Queue" description="Identity verification submissions awaiting decision." />

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((k) => {
                  const p = (k.profiles as unknown as { email?: string; full_name?: string; country?: string } | null) ?? null;
                  return (
                    <TableRow key={k.id}>
                      <TableCell>
                        <Link href={`/users/${k.user_id}`} className="hover:underline">
                          <div className="text-sm font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email}{p?.country ? ` · ${p.country}` : ""}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{k.doc_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm tabular-nums">{k.attempt_number}/3</TableCell>
                      <TableCell><StatusBadge value={k.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(k.submitted_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(k.reviewed_at)}</TableCell>
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
