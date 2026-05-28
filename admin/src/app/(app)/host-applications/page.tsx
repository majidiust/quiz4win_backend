import Link from "next/link";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTablePagination } from "@/components/data-table-pagination";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative, formatNumber } from "@/lib/utils";

export const metadata = { title: "Host Applications" };

const PAGE_SIZE = 25;
const STATUSES = ["pending", "accepted", "rejected", "info_requested"] as const;

interface SearchParams { status?: string; page?: string }

export default async function HostApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();

  let q = db
    .from("host_applications")
    .select(
      "id, name, email, country, instagram, followers, status, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.status && STATUSES.includes(sp.status as typeof STATUSES[number])) {
    q = q.eq("status", sp.status);
  }

  const [list, pendingC] = await Promise.all([
    q,
    db.from("host_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const { data, count, error } = list;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Host Applications"
        description={`${formatNumber(pendingC.count ?? 0)} pending review`}
      />

      {/* Status filter tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/host-applications"
          className={`rounded-md border px-3 py-1 text-xs ${!sp.status ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/host-applications?status=${s}`}
            className={`rounded-md border px-3 py-1 text-xs capitalize ${
              sp.status === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead className="text-right">Followers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">
                      <Link href={`/host-applications/${app.id}`} className="hover:underline">
                        {app.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{app.email}</TableCell>
                    <TableCell className="text-sm">{app.country ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {app.instagram ? (
                        <a
                          href={`https://instagram.com/${app.instagram.replace(/^@/, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{app.instagram.replace(/^@/, "")}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {app.followers != null ? formatNumber(app.followers) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={app.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(app.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/host-applications"
              searchParams={{ status: sp.status }}
            />
          </>
        ) : (
          <EmptyState icon={Users} title="No applications match the current filter" />
        )}
      </Card>
    </>
  );
}
