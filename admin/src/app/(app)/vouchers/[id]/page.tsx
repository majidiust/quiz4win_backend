import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber, formatRelative } from "@/lib/utils";
import { ToggleStatusButton, CancelVoucherButton, IssueVoucherButton } from "./voucher-actions";
import { VoucherEditForm } from "./voucher-edit-form";
import { ExportButton } from "@/components/export-button";

export const metadata = { title: "Voucher detail" };

export default async function VoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: voucher, error }, { data: redemptions }] = await Promise.all([
    db.from("vouchers").select("*").eq("id", id).maybeSingle(),
    db.from("voucher_redemptions")
      .select("id, user_id, redeemed_at, reward_applied, reward_type, reward_amount, note, profiles!user_id(full_name, email)")
      .eq("voucher_id", id)
      .order("redeemed_at", { ascending: false })
      .limit(50),
  ]);

  if (error || !voucher) notFound();

  return (
    <>
      <PageHeader
        title={voucher.code}
        description={voucher.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/vouchers"><ArrowLeft className="size-4" /> All vouchers</Link>
            </Button>
            <ExportButton href={`/api/exports/vouchers/${id}`} label="Export redemptions" />
            <ToggleStatusButton voucherId={id} currentStatus={voucher.status} />
            <IssueVoucherButton voucherId={id} currentStatus={voucher.status} />
            <CancelVoucherButton voucherId={id} currentStatus={voucher.status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-0 text-sm">
              <Row label="Status"><StatusBadge value={voucher.status} /></Row>
              <Row label="Type"><span className="capitalize">{voucher.type?.replace(/_/g, " ")}</span></Row>
              <Row label="Reward type"><span className="capitalize">{voucher.reward_type?.replace(/_/g, " ") ?? "—"}</span></Row>
              {voucher.reward_value ? <Row label="Reward value">{formatMoneyDecimal(voucher.reward_value)}</Row> : null}
              <Row label="Usage type"><span className="capitalize">{voucher.usage_type?.replace(/_/g, " ")}</span></Row>
              <Row label="Redeemed">{formatNumber(voucher.redemption_count)}{voucher.max_redemptions ? <> / {formatNumber(voucher.max_redemptions)}</> : null}</Row>
              <Row label="KYC required">{voucher.kyc_required ? "Yes" : "No"}</Row>
              <Row label="Case sensitive">{voucher.is_case_sensitive ? "Yes" : "No"}</Row>
              {voucher.valid_from ? <Row label="Valid from">{formatDateTime(voucher.valid_from)}</Row> : null}
              {voucher.valid_until ? <Row label="Valid until">{formatDateTime(voucher.valid_until)}</Row> : null}
              <Row label="Created">{formatRelative(voucher.created_at)}</Row>
              {voucher.cancellation_reason ? (
                <Row label="Cancellation reason"><span className="text-destructive">{voucher.cancellation_reason}</span></Row>
              ) : null}
            </CardContent>
          </Card>

          {voucher.partner_name ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Partner</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0">
                <Row label="Name">{voucher.partner_name}</Row>
                {voucher.partner_url ? <Row label="URL"><a href={voucher.partner_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{voucher.partner_url}</a></Row> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right column */}
        <div className="space-y-4 lg:col-span-2">
          {/* Edit form */}
          {voucher.status !== "cancelled" ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Edit voucher</CardTitle></CardHeader>
              <CardContent>
                <VoucherEditForm voucher={voucher} />
              </CardContent>
            </Card>
          ) : null}

          {/* Redemptions */}
          <Card>
            <CardHeader><CardTitle className="text-base">Recent redemptions ({redemptions?.length ?? 0})</CardTitle></CardHeader>
            {redemptions && redemptions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redemptions.map((r) => {
                    const p = (r.profiles as unknown as { full_name?: string; email?: string } | null) ?? null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link href={`/users/${r.user_id}`} className="text-xs hover:underline">
                            <div>{p?.full_name ?? "—"}</div>
                            <div className="text-muted-foreground">{p?.email}</div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {r.reward_type ? r.reward_type.replace(/_/g, " ") : r.reward_applied ? "wallet credit" : "—"}
                          {r.reward_amount ? <span className="ml-1 font-mono">{formatMoneyDecimal(r.reward_amount)}</span> : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.note ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatRelative(r.redeemed_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <CardContent><p className="text-sm text-muted-foreground">No redemptions yet.</p></CardContent>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}
