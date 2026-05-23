import {
  Users,
  UserPlus,
  Activity,
  Radio,
  CalendarClock,
  Trophy,
  Wallet,
  Banknote,
  CreditCard,
  ShieldCheck,
  LifeBuoy,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { getDashboardMetrics, getDailySeries } from "@/lib/queries/dashboard";
import { formatMoneyDecimal, formatNumber } from "@/lib/utils";
import { TrendChart } from "./trend-chart";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [metrics, series] = await Promise.all([getDashboardMetrics(), getDailySeries(14)]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Real-time overview of platform health, finance, and engagement."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Players" value={formatNumber(metrics.users.total)} icon={Users} hint="All-time registered" />
        <StatCard label="New (24h)" value={formatNumber(metrics.users.new24h)} icon={UserPlus} hint="Last 24 hours" />
        <StatCard label="Active (7d)" value={formatNumber(metrics.users.activeWeek)} icon={Activity} hint="Last 7 days" />
        <StatCard label="KYC Pending" value={formatNumber(metrics.kyc.pendingReviews)} icon={ShieldCheck} hint="Awaiting review" />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Live Games" value={formatNumber(metrics.games.liveNow)} icon={Radio} hint="In progress now" />
        <StatCard label="Upcoming" value={formatNumber(metrics.games.upcoming)} icon={CalendarClock} hint="Scheduled or open" />
        <StatCard label="Completed Today" value={formatNumber(metrics.games.completedToday)} icon={Trophy} hint="Since 00:00 UTC" />
        <StatCard label="Open Tickets" value={formatNumber(metrics.support.openTickets)} icon={LifeBuoy} hint="Needs attention" />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Wallet Liability"
          value={formatMoneyDecimal(metrics.finance.walletLiability)}
          icon={Wallet}
          hint="Sum of player balances"
        />
        <StatCard
          label="Pending Withdrawals"
          value={formatMoneyDecimal(metrics.finance.pendingWithdrawals)}
          icon={Banknote}
          hint="Awaiting approval/processing"
        />
        <StatCard
          label="Topups Today"
          value={formatMoneyDecimal(metrics.finance.topupsToday)}
          icon={CreditCard}
          hint="Settled today"
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signups · last 14 days</CardTitle>
            <CardDescription>Daily new player registrations</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <TrendChart data={series} dataKey="signups" color="var(--chart-1)" valueFormat="number" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Topups · last 14 days</CardTitle>
            <CardDescription>Daily settled top-up volume</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <TrendChart
              data={series}
              dataKey="topups"
              color="var(--chart-2)"
              valueFormat="money"
            />
          </CardContent>
        </Card>
      </section>
    </>
  );
}
