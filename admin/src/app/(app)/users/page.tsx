import Link from "next/link";
import { Users as UsersIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/status-badge";
import { SearchInput } from "@/components/search-input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { formatMoneyDecimal, formatRelative, initials } from "@/lib/utils";
import { requireAdmin } from "@/lib/auth";
import { ExportButton } from "@/components/export-button";
import { CreateUserDialog } from "./create-user-dialog";

export const metadata = { title: "Users" };

const PAGE_SIZE = 25;

interface SearchParams {
  q?: string;
  status?: string;
  page?: string;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("profiles")
    .select(
      "id, email, full_name, wallet_balance, kyc_status, status, country, total_games_played, aml_flagged, last_seen_at, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.q) q = q.or(`email.ilike.%${sp.q}%,full_name.ilike.%${sp.q}%`);
  if (sp.status) q = q.eq("status", sp.status);

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Users"
        description="All registered players and their account state."
        actions={
          <div className="flex items-center gap-2">
            <CreateUserDialog />
            <ExportButton href="/api/exports/users" />
          </div>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <SearchInput placeholder="Search email or name…" />
          <div className="text-xs text-muted-foreground">{count ?? 0} total</div>
        </div>

        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Games</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/users/${u.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar className="size-7">
                          <AvatarFallback className="text-[10px]">
                            {initials(u.full_name ?? u.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{u.full_name ?? "—"}</div>
                          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{u.country ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMoneyDecimal(u.wallet_balance)}</TableCell>
                    <TableCell>
                      <StatusBadge value={u.kyc_status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={u.status} />
                      {u.aml_flagged ? (
                        <span className="ml-1 inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          AML
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.total_games_played}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRelative(u.last_seen_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/users"
              searchParams={{ q: sp.q, status: sp.status }}
            />
          </>
        ) : (
          <EmptyState
            icon={UsersIcon}
            title="No users match the current filters"
            description="Adjust your search or clear filters to see more results."
          />
        )}
      </Card>
    </>
  );
}
