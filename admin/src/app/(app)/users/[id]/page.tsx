import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Wallet, Trophy, AlertOctagon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative, initials } from "@/lib/utils";

export const metadata = { title: "Player profile" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: user }, { data: txs }] = await Promise.all([
    db.from("profiles").select("*").eq("id", id).maybeSingle(),
    db
      .from("transactions")
      .select("id, type, amount, status, created_at, description")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!user) notFound();

  return (
    <>
      <PageHeader
        title={user.full_name ?? user.email}
        description={user.email}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/users"><ArrowLeft className="size-4" /> All users</Link>
          </Button>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center p-6 text-center">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">{initials(user.full_name ?? user.email)}</AvatarFallback>
            </Avatar>
            <div className="mt-3 text-base font-semibold">{user.full_name ?? "Unnamed"}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <StatusBadge value={user.status} />
              <StatusBadge value={user.kyc_status} />
              {user.aml_flagged ? <StatusBadge value="aml" /> : null}
            </div>
            <dl className="mt-4 grid w-full grid-cols-2 gap-2 text-left text-xs">
              <dt className="text-muted-foreground">Country</dt>
              <dd>{user.country ?? "—"}</dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd>{user.language}</dd>
              <dt className="text-muted-foreground">Joined</dt>
              <dd>{formatDateTime(user.created_at)}</dd>
              <dt className="text-muted-foreground">Last seen</dt>
              <dd>{formatRelative(user.last_seen_at)}</dd>
            </dl>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Wallet balance" value={formatMoneyDecimal(user.wallet_balance)} icon={Wallet} />
            <StatCard label="Lifetime prizes" value={formatMoneyDecimal(user.total_prizes_won)} icon={Trophy} />
            <StatCard label="Total deposited" value={formatMoneyDecimal(user.total_deposited)} icon={ShieldCheck} />
            <StatCard label="Total withdrawn" value={formatMoneyDecimal(user.total_withdrawn)} icon={AlertOctagon} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent transactions</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {txs && txs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txs.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm font-medium">{t.type.replace(/_/g, " ")}</TableCell>
                        <TableCell className="font-mono text-xs">{formatMoneyDecimal(t.amount)}</TableCell>
                        <TableCell><StatusBadge value={t.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatRelative(t.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-6 pb-6 text-sm text-muted-foreground">No transactions yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
