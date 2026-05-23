import { Link2, Tag, Users, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber } from "@/lib/utils";
import { CreatePromoDialog, DisablePromoButton } from "./referral-actions";

export const metadata = { title: "Referrals" };
const PAGE_SIZE = 25;
interface SearchParams { type?: string; page?: string }

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("referral_codes")
    .select(
      "code, type, owner_id, use_count, max_uses, bonus_amount, campaign_name, expires_at, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.type) q = q.eq("type", sp.type);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [list, codesC, promoC, usesTotal, uses30dC, bonusPaidC] = await Promise.all([
    q,
    db.from("referral_codes").select("code", { count: "exact", head: true }),
    db.from("referral_codes").select("code", { count: "exact", head: true }).eq("type", "promo"),
    db.from("referral_uses").select("id", { count: "exact", head: true }),
    db.from("referral_uses").select("id", { count: "exact", head: true }).gte("used_at", since),
    db.from("referral_uses").select("id", { count: "exact", head: true }).eq("bonus_paid", true),
  ]);
  const { data, count, error } = list;
  if (error) throw error;
  const conversionRate = (usesTotal.count ?? 0) ? (bonusPaidC.count ?? 0) / (usesTotal.count ?? 1) : 0;

  return (
    <>
      <PageHeader
        title="Referrals & Promo Codes"
        description="Player referrals and campaign codes."
        actions={<CreatePromoDialog />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total codes" value={formatNumber(codesC.count ?? 0)} icon={Tag} hint={`${formatNumber(promoC.count ?? 0)} promo`} />
        <StatCard label="Total uses" value={formatNumber(usesTotal.count ?? 0)} icon={Users} hint="all time" />
        <StatCard label="Uses · 30d" value={formatNumber(uses30dC.count ?? 0)} icon={Link2} hint="last 30 days" />
        <StatCard label="Conversion" value={`${(conversionRate * 100).toFixed(1)}%`} icon={TrendingUp} hint="bonus paid / uses" />
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Uses</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell><StatusBadge value={r.type} /></TableCell>
                    <TableCell className="text-xs">{r.campaign_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(r.use_count)}
                      {r.max_uses ? <span className="text-muted-foreground">/{formatNumber(r.max_uses)}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoneyDecimal(r.bonus_amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.expires_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>
                      <DisablePromoButton code={r.code} type={r.type} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/referrals" searchParams={{ type: sp.type }} />
          </>
        ) : (
          <EmptyState icon={Link2} title="No referral codes yet" />
        )}
      </Card>
    </>
  );
}
