import { UserPlus, ShieldCheck, Activity, UserX } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { TrendChart } from "@/app/(app)/dashboard/trend-chart";
import { formatNumber } from "@/lib/utils";
import { getUserAnalytics, resolveRange } from "@/lib/queries/analytics";
import { DateRangeFilter } from "../date-range-filter";

export const metadata = { title: "Users · Analytics" };

interface SP { from?: string; to?: string }

export default async function UserAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const data = await getUserAnalytics(range);

  const kycRate = data.newUsers > 0 ? (data.kycVerified / data.newUsers) * 100 : 0;

  return (
    <>
      <PageHeader
        title="User analytics"
        description="Signup velocity, KYC verification rate, and engagement health."
        actions={<DateRangeFilter />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New signups" value={formatNumber(data.newUsers)} icon={UserPlus} hint="In selected range" />
        <StatCard
          label="KYC verified"
          value={formatNumber(data.kycVerified)}
          icon={ShieldCheck}
          hint={`${kycRate.toFixed(1)}% of new signups`}
        />
        <StatCard label="Active (7d)" value={formatNumber(data.activeWeek)} icon={Activity} hint="Seen last 7 days" />
        <StatCard label="Suspended" value={formatNumber(data.suspended)} icon={UserX} hint="Currently suspended" />
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Daily signups</CardTitle>
            <CardDescription>New player registrations per day</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <TrendChart
              data={data.series}
              dataKey="signups"
              color="var(--chart-1)"
              valueFormatter={(v) => formatNumber(v)}
            />
          </CardContent>
        </Card>
      </section>
    </>
  );
}
