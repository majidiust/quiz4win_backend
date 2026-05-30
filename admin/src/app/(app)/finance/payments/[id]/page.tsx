import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User, ExternalLink, Hash, Clock, ShieldCheck } from "lucide-react";
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
                <DetailRow icon={Clock} label="Created">
                  {formatDateTime(p.created_at)} ({formatRelative(p.created_at)})
                </DetailRow>
              </div>
              <div className="space-y-4">
                <DetailRow label="Amount">
                  <span className="text-lg font-bold">{formatMoney(p.amount_cents, p.currency)}</span>
                </DetailRow>
                <DetailRow label="Verified">
                  {p.verified_at ? formatDateTime(p.verified_at) : "—"}
                </DetailRow>
                <DetailRow label="Completed">
                  {p.completed_at ? formatDateTime(p.completed_at) : "—"}
                </DetailRow>
                {p.transaction_id && (
                  <DetailRow label="Wallet Tx">
                    <Link href={`/finance/transactions?id=${p.transaction_id}`} className="font-mono text-[10px] text-blue-500 hover:underline">
                      {p.transaction_id}
                    </Link>
                  </DetailRow>
                )}
              </div>
            </div>

            {p.payment_link && p.status === "pending" && (
              <div className="mt-6 rounded-md border bg-muted/30 p-4">
                <div className="mb-2 text-xs font-medium text-muted-foreground uppercase">Gateway Link</div>
                <a href={p.payment_link} target="_blank" rel="noreferrer" className="break-all text-xs text-blue-500 hover:underline">
                  {p.payment_link}
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

        {/* Technical Details */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Gateway Response Data</CardTitle>
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
