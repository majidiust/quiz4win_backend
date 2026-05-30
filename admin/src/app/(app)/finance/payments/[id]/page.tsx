import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, User, ExternalLink, Hash, Clock, ShieldCheck,
  Fingerprint, Globe, Bitcoin, QrCode, Timer, FileJson, Link as LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoney, formatRelative, formatMoneyDecimal } from "@/lib/utils";
import { PaymentActions } from "./payment-actions";

export const metadata = { title: "Payment Details" };

interface ProfileShape {
  email?: string | null;
  full_name?: string | null;
  country?: string | null;
  kyc_status?: string | null;
  wallet_balance?: string | number | null;
  created_at?: string;
}

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: p, error } = await db
    .from("payments")
    .select("*, profiles(email, full_name, country, kyc_status, wallet_balance, created_at)")
    .eq("id", id)
    .maybeSingle();

  if (error || !p) notFound();

  const profile = (p.profiles as unknown as ProfileShape | null) ?? null;

  return (
    <>
      <PageHeader
        title={`Payment · ${p.provider_short_id || p.id.slice(0, 8)}`}
        description={`${p.method.toUpperCase()} · ${formatMoney(p.amount_cents, p.currency)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/finance/payments"><ArrowLeft className="size-4" /> Back to list</Link>
            </Button>
            <PaymentActions id={p.id} status={p.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Summary Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Transaction Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <DetailRow icon={ShieldCheck} label="Status">
                  <StatusBadge value={p.status} />
                </DetailRow>
                <DetailRow icon={Hash} label="Method">
                  <span className="capitalize">{p.method}</span>
                </DetailRow>
                <DetailRow icon={ExternalLink} label="Provider">
                  <span className="capitalize">{p.provider}</span>
                </DetailRow>
                <DetailRow label="Currency">
                  <span className="font-mono uppercase">{p.currency}</span>
                </DetailRow>
                <DetailRow icon={Globe} label="Client IP">
                  <span className="font-mono text-xs">{p.client_ip ?? "—"}</span>
                </DetailRow>
              </div>
              <div className="space-y-4">
                <DetailRow label="Amount">
                  <span className="text-lg font-bold">{formatMoney(p.amount_cents, p.currency)}</span>
                </DetailRow>
                <DetailRow icon={Clock} label="Created">
                  {formatDateTime(p.created_at)} ({formatRelative(p.created_at)})
                </DetailRow>
                <DetailRow label="Initiated">
                  {p.initiated_at ? `${formatDateTime(p.initiated_at)} (${formatRelative(p.initiated_at)})` : "—"}
                </DetailRow>
                <DetailRow label="Verified">
                  {p.verified_at ? `${formatDateTime(p.verified_at)} (${formatRelative(p.verified_at)})` : "—"}
                </DetailRow>
                <DetailRow label="Completed">
                  {p.completed_at ? `${formatDateTime(p.completed_at)} (${formatRelative(p.completed_at)})` : "—"}
                </DetailRow>
                <DetailRow label="Last updated">
                  {p.updated_at ? formatRelative(p.updated_at) : "—"}
                </DetailRow>
              </div>
            </div>

            {p.payment_link && (
              <div className="mt-6 rounded-md border bg-muted/30 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
                  <LinkIcon className="size-3" /> Gateway link
                </div>
                <a href={p.payment_link} target="_blank" rel="noreferrer" className="break-all text-xs text-blue-500 hover:underline">
                  {p.payment_link}
                </a>
              </div>
            )}
            {p.redirect_url && (
              <div className="mt-3 rounded-md border bg-muted/30 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
                  <LinkIcon className="size-3" /> Redirect URL
                </div>
                <a href={p.redirect_url} target="_blank" rel="noreferrer" className="break-all text-xs text-blue-500 hover:underline">
                  {p.redirect_url}
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Player Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="size-4" /> Player
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium">{profile?.full_name || "Unknown"}</div>
              <div className="text-xs text-muted-foreground">{profile?.email}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-muted-foreground">Country:</div>
              <div>{profile?.country || "—"}</div>
              <div className="text-muted-foreground">KYC:</div>
              <div><StatusBadge value={profile?.kyc_status || "unknown"} /></div>
              <div className="text-muted-foreground">Wallet:</div>
              <div className="font-mono">{formatMoneyDecimal(profile?.wallet_balance)}</div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full mt-2">
              <Link href={`/users/${p.user_id}`}>View Profile</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Identifiers */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Fingerprint className="size-4" /> Identifiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <DetailRow label="Internal ID">
                <span className="font-mono text-[11px] break-all">{p.id}</span>
              </DetailRow>
              <DetailRow label="Provider Payment ID">
                <span className="font-mono text-[11px] break-all">{p.provider_payment_id ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Provider Short ID">
                <span className="font-mono text-[11px] break-all">{p.provider_short_id ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Wallet Transaction">
                {p.transaction_id ? (
                  <Link
                    href={`/finance/transactions?id=${p.transaction_id}`}
                    className="font-mono text-[11px] text-blue-500 break-all hover:underline"
                  >
                    {p.transaction_id}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailRow>
            </div>
          </CardContent>
        </Card>

        {/* Crypto-specific details */}
        {p.method === "crypto" && (p.pay_address || p.pay_amount || p.pay_currency || p.qr_url || p.expires_at) && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bitcoin className="size-4" /> Crypto Payment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="Coin">
                  <span className="font-mono uppercase">{p.pay_currency ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Pay Amount">
                  <span className="font-mono">{p.pay_amount ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Pay Address">
                  <span className="font-mono text-[11px] break-all">{p.pay_address ?? "—"}</span>
                </DetailRow>
                <DetailRow icon={Timer} label="Expires">
                  {p.expires_at ? `${formatDateTime(p.expires_at)} (${formatRelative(p.expires_at)})` : "—"}
                </DetailRow>
              </div>
              {p.qr_url && (
                <div className="mt-4 flex items-start gap-4 rounded-md border bg-muted/30 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.qr_url} alt="Payment QR code" className="h-32 w-32 rounded-md border bg-white" />
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center gap-1.5 font-medium uppercase text-muted-foreground">
                      <QrCode className="size-3" /> QR Code
                    </div>
                    <a href={p.qr_url} target="_blank" rel="noreferrer" className="break-all text-blue-500 hover:underline">
                      {p.qr_url}
                    </a>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Extra data */}
        {p.extra_data && Object.keys(p.extra_data as Record<string, unknown>).length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileJson className="size-4" /> Extra Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md bg-zinc-950 p-4 overflow-x-auto">
                <pre className="font-mono text-[11px] text-zinc-300">
                  {JSON.stringify(p.extra_data, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Gateway Response */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="size-4" /> Gateway Response Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md bg-zinc-950 p-4 overflow-x-auto">
              <pre className="font-mono text-[11px] text-zinc-300">
                {JSON.stringify(p.provider_response || { message: "No response data yet" }, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon?: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
