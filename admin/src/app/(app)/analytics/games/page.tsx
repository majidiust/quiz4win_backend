import { Gamepad2, Trophy, Users, Percent } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { TrendChart } from "@/app/(app)/dashboard/trend-chart";
import { formatNumber, formatMoneyDecimal } from "@/lib/utils";
import { getGameAnalytics, resolveRange } from "@/lib/queries/analytics";
import { DateRangeFilter } from "../date-range-filter";

export const metadata = { title: "Games · Analytics" };

interface SP { from?: string; to?: string }

export default async function GamesAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const data = await getGameAnalytics(range);

  return (
    <>
      <PageHeader
        title="Game analytics"
        description="Game volume, participation, and prize-pool distribution by mode."
        actions={<DateRangeFilter />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total games" value={formatNumber(data.totalGames)} icon={Gamepad2} hint="In selected range" />
        <StatCard label="Total players" value={formatNumber(data.totalParticipants)} icon={Users} hint="Across all games" />
        <StatCard
          label="Prize pool"
          value={formatMoneyDecimal(data.totalPrizePool)}
          icon={Trophy}
          hint="Total prizes distributed"
        />
        <StatCard
          label="Completion rate"
          value={`${(data.completionRate * 100).toFixed(1)}%`}
          icon={Percent}
          hint="Completed / created"
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Daily games</CardTitle>
            <CardDescription>New games scheduled or played per day</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <TrendChart
              data={data.series}
              dataKey="games"
              color="var(--chart-2)"
              valueFormat="number"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By mode</CardTitle>
            <CardDescription>Breakdown by game mode</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.byMode.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No games in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Games</TableHead>
                    <TableHead className="text-right">Players</TableHead>
                    <TableHead className="text-right">Prizes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byMode.map((m) => (
                    <TableRow key={m.mode}>
                      <TableCell className="font-medium capitalize">{m.mode}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(m.count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(m.participants)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyDecimal(m.prizePool)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
