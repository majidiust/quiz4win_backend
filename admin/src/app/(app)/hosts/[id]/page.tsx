import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Globe, MapPin, Phone, Link2, Send, FileText, ListChecks, Mail, Wallet, CreditCard, Video, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { DetailSection, DetailRow, SummaryCell } from "@/components/detail";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { presignGet } from "@/lib/s3";
import { formatDateTime, formatRelative, formatMoneyDecimal, formatNumber } from "@/lib/utils";
import {
  HostStatusActions, FileActions, RequestActions, InvitationActions,
  EarningActions, EarningCreateButton, InvitationSendButton, PaymentMethodActions,
} from "./host-actions";
import { HostFileLink, IntroVideoPlayer, InlineImageViewer } from "./host-media";

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data } = await db.from("show_hosts").select("name").eq("id", id).single();
  return { title: data ? `${data.name} — Host` : "Host" };
}

export default async function HostDetailPage({ params }: Props) {
  await requireAdmin(["super_admin", "admin", "moderator", "finance"]);
  const { id: hostId } = await params;
  const db = createSupabaseAdminClient();

  const { data: host } = await db.from("show_hosts").select("*").eq("id", hostId).maybeSingle();
  if (!host) notFound();

  const [filesQ, reqsQ, invsQ, earningsQ, methodsQ, availableGamesQ, withdrawalsQ] = await Promise.all([
    db.from("host_uploaded_files").select("*").eq("host_id", hostId).order("created_at", { ascending: false }),
    db.from("host_game_requests").select("*, games(id, title, scheduled_at, status)").eq("host_id", hostId).order("created_at", { ascending: false }),
    db.from("host_invitations").select("*, games(id, title, scheduled_at, status)").eq("host_id", hostId).order("created_at", { ascending: false }),
    db.from("host_earnings").select("*, games(id, title, ended_at)").eq("host_id", hostId).order("created_at", { ascending: false }),
    db.from("host_payment_methods").select("*").eq("host_id", hostId).order("created_at", { ascending: false }),
    db.from("games").select("id, title, scheduled_at").is("host_id", null).eq("mode", "live").eq("status", "upcoming").order("scheduled_at", { ascending: true }).limit(50),
    db.from("host_withdrawals").select("id, amount, currency, status, crypto_coin, crypto_network, requested_at, completed_at, transaction_reference").eq("host_id", hostId).order("requested_at", { ascending: false }).limit(50),
  ]);

  const files = filesQ.data ?? [];
  const requests = reqsQ.data ?? [];
  const invitations = invsQ.data ?? [];
  const earnings = earningsQ.data ?? [];
  const methods = methodsQ.data ?? [];
  const availableGames = availableGamesQ.data ?? [];
  const withdrawals = withdrawalsQ.data ?? [];

  const totals = earnings.reduce<Record<string, number>>((a, r) => {
    a[r.status as string] = (a[r.status as string] ?? 0) + Number(r.amount ?? 0);
    return a;
  }, {});

  const langs = (host.languages as string[] | null) ?? [];
  const social: { url: string | null; label: string }[] = [
    { url: host.instagram_url as string | null, label: "Instagram" },
    { url: host.telegram_url as string | null, label: "Telegram" },
    { url: host.youtube_url as string | null, label: "YouTube" },
    { url: host.tiktok_url as string | null, label: "TikTok" },
    { url: host.twitter_url as string | null, label: "Twitter / X" },
    { url: host.website_url as string | null, label: "Website" },
  ].filter((s) => s.url);

  // Most recent intro video, selfie, and ID document — viewed via presigned URLs.
  type UploadedFile = { id: string; file_type: string; s3_key: string | null; url: string | null; mime_type: string | null };
  const introVideo = files.find((f) => f.file_type === "intro_video") as UploadedFile | undefined;
  const selfieFile = files.find((f) => f.file_type === "selfie") as UploadedFile | undefined;
  const idDocFile = files.find((f) => f.file_type === "id_document") as UploadedFile | undefined;

  // Pre-compute presigned URLs server-side so the admin sees files immediately
  // without requiring a client-side click. Presign window: 1 hour (3600 s).
  async function resolveFileUrl(file: UploadedFile | undefined): Promise<string | null> {
    if (!file) return null;
    if (file.url && (file.url as string).length > 0) return file.url as string;
    if (!file.s3_key) return null;
    try { return await presignGet(file.s3_key as string, 3600); } catch { return null; }
  }

  const [introVideoSrc, selfieSrc, idDocSrc] = await Promise.all([
    resolveFileUrl(introVideo),
    resolveFileUrl(selfieFile),
    resolveFileUrl(idDocFile),
  ]);

  const avatarUrl = (host.avatar_url as string | null) ?? null;
  const initials = (host.name as string).split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <>
      <div className="mb-4">
        <Link href="/hosts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Hosts
        </Link>
      </div>

      <PageHeader
        title={host.name as string}
        description={(host.short_bio as string) ?? "Host profile"}
        actions={<HostStatusActions hostId={hostId} currentStatus={host.application_status as string} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge value={host.application_status as string} />
        <StatusBadge value={host.status as string} />
        {!host.auth_user_id ? (
          <Badge variant="warning">admin-managed</Badge>
        ) : null}
        {host.country ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPin className="size-3" />{host.country as string}</span>
        ) : null}
        {langs.length ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Globe className="size-3" />{langs.join(", ")}</span>
        ) : null}
        {host.phone ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Phone className="size-3" />{host.phone as string}</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tabs defaultValue="files">
            <TabsList>
              <TabsTrigger value="files">Files ({files.length})</TabsTrigger>
              <TabsTrigger value="requests">Requests ({requests.length})</TabsTrigger>
              <TabsTrigger value="invitations">Invitations ({invitations.length})</TabsTrigger>
              <TabsTrigger value="earnings">Earnings ({earnings.length})</TabsTrigger>
              <TabsTrigger value="methods">Payout ({methods.length})</TabsTrigger>
              <TabsTrigger value="withdrawals">Withdrawals ({withdrawals.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="files">
              <Card>
                <CardContent className="p-0">
                  {files.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead><TableHead>Status</TableHead>
                          <TableHead>Uploaded</TableHead><TableHead>Size</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {files.map((f) => (
                          <TableRow key={f.id as string}>
                            <TableCell className="font-medium">
                              <HostFileLink fileId={f.id as string} label={(f.file_type as string).replace(/_/g, " ")} />
                            </TableCell>
                            <TableCell><StatusBadge value={f.status as string} /></TableCell>
                            <TableCell className="text-muted-foreground">{formatRelative(f.created_at as string)}</TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {f.file_size_bytes ? `${Math.round(Number(f.file_size_bytes) / 1024)} KB` : "—"}
                            </TableCell>
                            <TableCell className="text-right"><FileActions fileId={f.id as string} status={f.status as string} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={FileText} title="No files uploaded" description="The host has not submitted any verification files yet." />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="requests">
              <Card>
                <CardContent className="p-0">
                  {requests.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Game</TableHead><TableHead>Status</TableHead>
                          <TableHead>Scheduled</TableHead><TableHead>Note</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.map((r) => {
                          const g = r.games as { id?: string; title?: string; scheduled_at?: string; status?: string } | null;
                          return (
                            <TableRow key={r.id as string}>
                              <TableCell className="font-medium">{g?.title ?? "—"}</TableCell>
                              <TableCell><StatusBadge value={r.status as string} /></TableCell>
                              <TableCell className="text-muted-foreground">{g?.scheduled_at ? formatDateTime(g.scheduled_at) : "—"}</TableCell>
                              <TableCell className="text-muted-foreground line-clamp-1 max-w-[14rem]">{(r.host_note as string) ?? "—"}</TableCell>
                              <TableCell className="text-right"><RequestActions requestId={r.id as string} status={r.status as string} /></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={ListChecks} title="No requests" description="This host has not requested any games." />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="invitations">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Invitations</CardTitle>
                  {host.application_status === "approved" ? (
                    <InvitationSendButton hostId={hostId} availableGames={availableGames as { id: string; title: string; scheduled_at: string | null }[]} />
                  ) : null}
                </CardHeader>
                <CardContent className="p-0">
                  {invitations.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Game</TableHead><TableHead>Status</TableHead>
                          <TableHead>Sent</TableHead><TableHead>Expires</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invitations.map((i) => {
                          const g = i.games as { id?: string; title?: string; scheduled_at?: string } | null;
                          return (
                            <TableRow key={i.id as string}>
                              <TableCell className="font-medium">{g?.title ?? "—"}</TableCell>
                              <TableCell><StatusBadge value={i.status as string} /></TableCell>
                              <TableCell className="text-muted-foreground">{formatRelative(i.created_at as string)}</TableCell>
                              <TableCell className="text-muted-foreground">{i.expires_at ? formatDateTime(i.expires_at as string) : "—"}</TableCell>
                              <TableCell className="text-right"><InvitationActions invitationId={i.id as string} status={i.status as string} /></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={Mail} title="No invitations" description="Send an invitation to assign this host to an upcoming game." />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="earnings">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Earnings</CardTitle>
                  <EarningCreateButton hostId={hostId} hostedGames={(invitations.filter((i) => i.status === "accepted").map((i) => i.games).filter(Boolean) as { id: string; title: string }[])} />
                </CardHeader>
                <CardContent className="p-0">
                  {earnings.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Game</TableHead><TableHead>Status</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Created</TableHead><TableHead>Approved</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {earnings.map((e) => {
                          const g = e.games as { title?: string } | null;
                          return (
                            <TableRow key={e.id as string}>
                              <TableCell className="font-medium">{g?.title ?? "—"}</TableCell>
                              <TableCell><StatusBadge value={e.status as string} /></TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoneyDecimal(e.amount as string | number, (e.currency as string) ?? "USD")}</TableCell>
                              <TableCell className="text-muted-foreground">{formatRelative(e.created_at as string)}</TableCell>
                              <TableCell className="text-muted-foreground">{e.approved_at ? formatRelative(e.approved_at as string) : "—"}</TableCell>
                              <TableCell className="text-right"><EarningActions earningId={e.id as string} status={e.status as string} /></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={Wallet} title="No earnings recorded" description="Approved post-game earnings will be listed here." />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="methods">
              <Card>
                <CardContent className="p-0">
                  {methods.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead><TableHead>Label</TableHead>
                          <TableHead>Status</TableHead><TableHead>Default</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {methods.map((m) => (
                          <TableRow key={m.id as string}>
                            <TableCell className="font-medium">{(m.method_type as string).replace(/_/g, " ")}</TableCell>
                            <TableCell className="text-muted-foreground">{(m.label as string) ?? "—"}</TableCell>
                            <TableCell><StatusBadge value={m.status as string} /></TableCell>
                            <TableCell>{m.is_default ? <Badge variant="success">default</Badge> : "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{formatRelative(m.created_at as string)}</TableCell>
                            <TableCell className="text-right"><PaymentMethodActions methodId={m.id as string} status={m.status as string} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={CreditCard} title="No payout methods" description="The host has not added any payout destinations yet." />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="withdrawals">
              <Card>
                <CardContent className="p-0">
                  {withdrawals.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Amount</TableHead>
                          <TableHead>Coin</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead className="text-right">Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {withdrawals.map((w) => (
                          <TableRow key={w.id as string}>
                            <TableCell className="font-mono text-xs">{formatMoneyDecimal(w.amount as string | number)}</TableCell>
                            <TableCell className="text-xs">
                              {(w.crypto_coin as string | null) ?? "—"}
                              {w.crypto_network ? <span className="text-muted-foreground"> · {w.crypto_network as string}</span> : null}
                            </TableCell>
                            <TableCell><StatusBadge value={w.status as string} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatRelative(w.requested_at as string)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{w.completed_at ? formatRelative(w.completed_at as string) : "—"}</TableCell>
                            <TableCell className="text-right">
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/finance/host-withdrawals/${w.id as string}`}>Open</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={Wallet} title="No withdrawal requests" description="This host has not requested any payouts yet." />}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <DetailSection title="Onboarding profile" icon={Users}>
            <div className="flex items-center gap-3">
              <Avatar className="size-16">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={host.name as string} /> : null}
                <AvatarFallback className="text-lg">{initials || "?"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate font-medium">{host.name as string}</div>
                {host.short_bio ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{host.short_bio as string}</p>
                ) : null}
              </div>
            </div>
            <DetailRow label="Country" value={host.country as string | null} icon={MapPin} />
            <DetailRow label="Languages" value={langs.length ? langs.join(", ") : null} icon={Globe} />
            <DetailRow label="Phone" value={host.phone as string | null} icon={Phone} />
            {host.bio ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">About</div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{host.bio as string}</p>
              </div>
            ) : null}
            {social.length ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Social</div>
                <div className="space-y-1">
                  {social.map((s) => (
                    <a key={s.label} href={s.url!} target="_blank" rel="noreferrer"
                       className="block truncate text-sm text-primary hover:underline">
                      <Link2 className="mr-1 inline size-3" />{s.label}: {s.url}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Video className="size-3" />Intro video
              </div>
              {introVideo ? (
                <IntroVideoPlayer src={introVideoSrc} fileId={introVideo.id} />
              ) : (
                <p className="text-sm text-muted-foreground">Not uploaded.</p>
              )}
            </div>
            {selfieFile ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Selfie</div>
                <InlineImageViewer src={selfieSrc} fileId={selfieFile.id} label="selfie" />
              </div>
            ) : null}
            {idDocFile ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">ID document</div>
                <InlineImageViewer src={idDocSrc} fileId={idDocFile.id} label="ID document" />
              </div>
            ) : null}
          </DetailSection>

          <DetailSection title="Timeline" icon={CalendarClock}>
            <DetailRow label="Joined" value={host.created_at ? formatDateTime(host.created_at as string) : null} />
            <DetailRow label="Applied" value={host.applied_at ? formatDateTime(host.applied_at as string) : null} />
            <DetailRow label="Approved" value={host.approved_at ? formatDateTime(host.approved_at as string) : null} />
            {host.rejected_at ? <DetailRow label="Rejected" value={formatDateTime(host.rejected_at as string)} /> : null}
            {host.suspended_at ? <DetailRow label="Suspended" value={formatDateTime(host.suspended_at as string)} /> : null}
            <DetailRow label="Auth user" value={host.auth_user_id ? <code className="text-xs">{(host.auth_user_id as string).slice(0, 8)}…</code> : null} />
            {host.rejection_reason ? (
              <DetailRow label="Rejection reason" value={<span className="text-destructive">{host.rejection_reason as string}</span>} />
            ) : null}
            {host.suspension_reason ? (
              <DetailRow label="Suspension reason" value={<span className="text-warning">{host.suspension_reason as string}</span>} />
            ) : null}
          </DetailSection>

          <DetailSection title="Earnings summary" icon={Send}>
            <div className="grid grid-cols-2 gap-2">
              <SummaryCell label="Pending" value={formatMoneyDecimal(totals.pending ?? 0)} />
              <SummaryCell label="Approved" value={formatMoneyDecimal(totals.approved ?? 0)} />
              <SummaryCell label="Paid" value={formatMoneyDecimal(totals.paid ?? 0)} />
              <SummaryCell label="Cancelled" value={formatMoneyDecimal(totals.cancelled ?? 0)} />
              <SummaryCell label="Lifetime" value={formatMoneyDecimal(host.total_earnings as string | number)} highlight />
              <SummaryCell label="Shows hosted" value={formatNumber(host.shows_hosted as number)} highlight />
            </div>
          </DetailSection>
        </aside>
      </div>
    </>
  );
}
