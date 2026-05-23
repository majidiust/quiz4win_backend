import { LineChart, DollarSign, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { TrendChart } from "@/app/(app)/dashboard/trend-chart";
import { formatMoneyDecimal } from "@/lib/utils";
import { getRevenueAnalytics, resolveRange } from "@/lib/queries/analytics";
import { DateRangeFilter } from "../date-range-filter";

export const metadata = { title: "Revenue · Analytics" };

interface SP { from?: string; to?: string }

export default async function RevenueAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const data = await getRevenueAnalytics(range);

  const currencies = Object.entries(data.byCurrency).sort((a, b) => b[1] - a[1]);
  const avgPerDay = data.series.length > 0 ? data.totalRevenue / data.series.length : 0;

  return (
    <>
      <PageHeader
        title="Revenue analytics"
        description="Settled top-up revenue, broken down by day and currency."
        actions={<DateRangeFilter />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total revenue"
          value={formatMoneyDecimal(data.totalRevenue)}
          icon={DollarSign}
          hint={`${data.series.length} day window`}
        />
        <StatCard
          label="Avg per day"
          value={formatMoneyDecimal(avgPerDay)}
          icon={LineChart}
          hint="Settled top-ups only"
        />
        <StatCard
          label="Currencies"
          value={String(currencies.length)}
          icon={Globe}
          hint={currencies[0] ? `Top: ${currencies[0][0]}` : "—"}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Daily revenue</CardTitle>
            <CardDescription>Sum of completed top-ups per day</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <TrendChart
              data={data.series}
              dataKey="revenue"
              color="var(--chart-1)"
              valueFormat="money"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By currency</CardTitle>
            <CardDescription>Revenue split across currencies</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {currencies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revenue in this range.</p>
            ) : (
              currencies.map(([cur, amt]) => {
                const pct = data.totalRevenue > 0 ? (amt / data.totalRevenue) * 100 : 0;
                return (
                  <div key={cur}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium">{cur}</span>
                      <span className="font-mono text-xs">{formatMoneyDecimal(amt, cur)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct.toFixed(2)}%` }}
                      />
                    </div>
                    <div className="mt-0.5 text-right text-[10px] text-muted-foreground">{pct.toFixed(1)}%</div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
