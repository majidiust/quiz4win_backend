import { Smartphone, Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTablePagination } from "@/components/data-table-pagination";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative, formatNumber } from "@/lib/utils";
import { ResendEmailButton } from "./resend-button";

export const metadata = { title: "Early Birds" };

const PAGE_SIZE = 50;

interface SearchParams { platform?: string; page?: string }

export default async function EarlyBirdsPage({
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
    .from("early_birds")
    .select("id, platform, name, email, country, country_code, welcome_email_sent_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.platform === "ios" || sp.platform === "android") {
    q = q.eq("platform", sp.platform);
  }

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Early Birds"
        description={`${formatNumber(count ?? 0)} total sign-ups for mobile access`}
      />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Platform</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email / Apple ID</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Signed Up</TableHead>
                  <TableHead>Email Sent</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((bird) => (
                  <TableRow key={bird.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-medium uppercase">{bird.platform}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{bird.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{bird.email}</TableCell>
                    <TableCell className="text-sm">
                      {bird.country_code ? (
                        <span className="flex items-center gap-1.5" title={bird.country}>
                          <span className="text-muted-foreground uppercase">{bird.country_code}</span>
                          {bird.country && <span className="truncate max-w-[120px] text-xs">({bird.country})</span>}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(bird.created_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {bird.welcome_email_sent_at ? (
                        <span className="text-green-600 font-medium">{formatRelative(bird.welcome_email_sent_at)}</span>
                      ) : (
                        <span className="text-amber-600">Pending</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ResendEmailButton birdId={bird.id} hasSent={!!bird.welcome_email_sent_at} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/early-birds"
              searchParams={{ platform: sp.platform }}
            />
          </>
        ) : (
          <EmptyState icon={Mail} title="No early bird sign-ups found" />
        )}
      </Card>
    </>
  );
}
