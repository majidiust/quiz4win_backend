import { CreditCard, Banknote, Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { TrendChart } from "@/app/(app)/dashboard/trend-chart";
import { formatMoneyDecimal } from "@/lib/utils";
import { getFinanceAnalytics, resolveRange } from "@/lib/queries/analytics";
import { DateRangeFilter } from "../date-range-filter";

export const metadata = { title: "Finance · Analytics" };

interface SP { from?: string; to?: string }

export default async function FinanceAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const data = await getFinanceAnalytics(range);
  const ngr = data.topups - data.withdrawals;

  const rows = [
    { label: "Deposits (top-ups)", value: data.topups, positive: true },
    { label: "Entry fees collected", value: data.entryFees, positive: true },
    { label: "Prizes paid", value: -data.prizesPaid, positive: false },
    { label: "Refunds", value: -data.refunds, positive: false },
    { label: "Withdrawals processed", value: -data.withdrawals, positive: false },
  ];

  return (
    <>
      <PageHeader
        title="Finance analytics"
        description="Platform P&L: deposits vs prizes vs withdrawals vs fees."
        actions={<DateRangeFilter />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Top-ups" value={formatMoneyDecimal(data.topups)} icon={CreditCard} hint="Deposits in" />
        <StatCard label="Withdrawals" value={formatMoneyDecimal(data.withdrawals)} icon={Banknote} hint="Payouts out" />
        <StatCard label="Prizes paid" value={formatMoneyDecimal(data.prizesPaid)} icon={Trophy} hint="To players" />
        <StatCard
          label="Platform margin"
          value={formatMoneyDecimal(data.platformMargin)}
          icon={TrendingUp}
          hint="Entry fees − prizes − refunds"
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Daily top-ups vs withdrawals</CardTitle>
            <CardDescription>Net Gaming Revenue trend</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <TrendChart
              data={data.series}
              dataKey="topups"
              color="var(--chart-1)"
              valueFormat="money"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>P&L summary</CardTitle>
            <CardDescription>NGR: {formatMoneyDecimal(ngr)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between border-b py-1.5 last:border-0">
                <span className="text-muted-foreground">{r.label}</span>
                <span
                  className={
                    r.positive
                      ? "font-mono text-xs text-success"
                      : "font-mono text-xs text-destructive"
                  }
                >
                  {r.value >= 0 ? "+" : ""}
                  {formatMoneyDecimal(r.value)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
