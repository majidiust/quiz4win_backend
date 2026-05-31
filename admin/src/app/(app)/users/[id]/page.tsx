import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Wallet, Trophy, AlertOctagon, Gamepad2 } from "lucide-react";
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
import { UserActions } from "./user-actions";
import { AuthActions } from "./auth-actions";
import { CustomEmailAction } from "./custom-email-action";

export const metadata = { title: "Player profile" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: user }, { data: txs }, { data: games }, { data: wins }, authRes] = await Promise.all([
    db.from("profiles").select("*").eq("id", id).maybeSingle(),
    db
      .from("transactions")
      .select("id, type, amount, status, created_at, description")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("game_participants")
      .select("game_id, score, rank, prize_earned, entry_fee_paid, joined_at, games(title, mode, status)")
      .eq("user_id", id)
      .order("joined_at", { ascending: false })
      .limit(20),
    db
      .from("game_participants")
      .select("game_id, score, rank, prize_earned, joined_at, games(title, mode, status, prize_pool_currency, ended_at)")
      .eq("user_id", id)
      .gt("prize_earned", 0)
      .order("rank", { ascending: true })
      .limit(50),
    db.auth.admin.getUserById(id),
  ]);

  if (!user) notFound();
  const authUser = authRes.data?.user ?? null;
  const isBanned = authUser?.banned_until ? new Date(authUser.banned_until) > new Date() : false;

  return (
    <>
      <PageHeader
        title={user.full_name ?? user.email}
        description={user.email}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/users"><ArrowLeft className="size-4" /> All users</Link>
            </Button>
            <CustomEmailAction userId={id} userEmail={user.email} />
            <UserActions userId={id} currentStatus={user.status} />
            <AuthActions userId={id} userEmail={user.email} isBanned={isBanned} emailConfirmed={!!authUser?.email_confirmed_at} />
          </div>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-4">
        <Card>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">Email confirmed</dt>
              <dd>{authUser?.email_confirmed_at ? formatDateTime(authUser.email_confirmed_at) : <span className="text-amber-500">Not confirmed</span>}</dd>
              <dt className="text-muted-foreground">Last sign in</dt>
              <dd>{authUser?.last_sign_in_at ? formatRelative(authUser.last_sign_in_at) : "Never"}</dd>
              <dt className="text-muted-foreground">Banned until</dt>
              <dd>{isBanned && authUser?.banned_until ? formatDateTime(authUser.banned_until) : <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{authUser?.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Providers</dt>
              <dd>{authUser?.identities?.length ? authUser.identities.map((i) => i.provider).join(", ") : "email"}</dd>
              <dt className="text-muted-foreground">Auth ID</dt>
              <dd className="truncate font-mono">{authUser?.id ?? "—"}</dd>
            </dl>
            {authUser?.user_metadata && Object.keys(authUser.user_metadata).length > 0 && (
              <div>
                <div className="mb-1 text-muted-foreground">User metadata</div>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-[10px] leading-tight">{JSON.stringify(authUser.user_metadata, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Wallet balance" value={formatMoneyDecimal(user.wallet_balance)} icon={Wallet} />
            <StatCard label="Lifetime prizes" value={formatMoneyDecimal(user.total_prizes_won)} icon={Trophy} />
            <StatCard label="Total deposited" value={formatMoneyDecimal(user.total_deposited)} icon={ShieldCheck} />
            <StatCard label="Total withdrawn" value={formatMoneyDecimal(user.total_withdrawn)} icon={AlertOctagon} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Trophy className="size-4 text-yellow-500" /> Wins</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {wins && wins.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Game</TableHead>
                      <TableHead className="text-right">Rank</TableHead>
                      <TableHead className="text-right">Prize</TableHead>
                      <TableHead>Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wins.map((w) => {
                      const game = w.games as { title?: string; mode?: string; status?: string; prize_pool_currency?: string | null; ended_at?: string | null } | null;
                      return (
                        <TableRow key={w.game_id}>
                          <TableCell className="text-sm font-medium">
                            <Link href={`/games/${w.game_id}`} className="hover:underline">{game?.title ?? "—"}</Link>
                            <div className="text-xs text-muted-foreground capitalize">{game?.mode?.replace(/_/g, " ") ?? ""}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {w.rank === 1 ? <Trophy className="inline size-3 text-yellow-500" /> : null} #{w.rank ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatMoneyDecimal(w.prize_earned)}
                            <span className="ml-1 text-[10px] text-muted-foreground">{game?.prize_pool_currency ?? "USD"}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{game?.ended_at ? formatRelative(game.ended_at) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-6 pb-6 text-sm text-muted-foreground">No wins yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Gamepad2 className="size-4" /> Recent games</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {games && games.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Game</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Rank</TableHead>
                      <TableHead>Prize</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {games.map((g) => {
                      const game = g.games as { title?: string; mode?: string; status?: string } | null;
                      return (
                        <TableRow key={g.game_id}>
                          <TableCell className="text-sm font-medium">{game?.title ?? "—"}</TableCell>
                          <TableCell className="text-xs capitalize">{game?.mode?.replace(/_/g, " ") ?? "—"}</TableCell>
                          <TableCell className="text-xs">{g.score}</TableCell>
                          <TableCell className="text-xs">{g.rank ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{formatMoneyDecimal(g.prize_earned)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatRelative(g.joined_at)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-6 pb-6 text-sm text-muted-foreground">No games played yet.</div>
              )}
            </CardContent>
          </Card>

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
