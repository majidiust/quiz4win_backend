import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { signKycDocumentUrl } from "@/lib/actions/kyc";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "KYC submission" };

interface ProfileShape {
  email?: string | null;
  full_name?: string | null;
  country?: string | null;
  kyc_status?: string | null;
}

export default async function KycDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: kyc, error } = await db
    .from("kyc_requests")
    .select(
      "id, user_id, doc_type, status, attempt_number, rejection_reason, submitted_at, reviewed_at, reviewed_by, front_image_url, back_image_url, selfie_url, profiles!kyc_requests_user_id_fkey(email, full_name, country, kyc_status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !kyc) notFound();

  const profile = (kyc.profiles as unknown as ProfileShape | null) ?? null;
  const [frontUrl, backUrl, selfieUrl] = await Promise.all([
    signKycDocumentUrl(kyc.front_image_url),
    signKycDocumentUrl(kyc.back_image_url),
    signKycDocumentUrl(kyc.selfie_url),
  ]);

  const isPending = kyc.status === "pending";

  return (
    <>
      <PageHeader
        title={`KYC · ${profile?.full_name ?? profile?.email ?? "Player"}`}
        description={`${kyc.doc_type.replace(/_/g, " ")} · attempt ${kyc.attempt_number}/3`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/kyc">
                <ArrowLeft className="size-4" /> Back to queue
              </Link>
            </Button>
            {isPending ? <ReviewActions kycId={kyc.id} /> : null}
          </div>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Status"><StatusBadge value={kyc.status} /></Row>
            <Row label="Profile KYC"><StatusBadge value={profile?.kyc_status ?? "unknown"} /></Row>
            <Row label="Document">{kyc.doc_type.replace(/_/g, " ")}</Row>
            <Row label="Attempt">{kyc.attempt_number} of 3</Row>
            <Row label="Submitted">{formatDateTime(kyc.submitted_at)}</Row>
            <Row label="Reviewed">{kyc.reviewed_at ? formatRelative(kyc.reviewed_at) : "—"}</Row>
            {kyc.rejection_reason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" /> Previous rejection
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{kyc.rejection_reason}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Player</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Name">{profile?.full_name ?? "—"}</Row>
            <Row label="Email">{profile?.email ?? "—"}</Row>
            <Row label="Country">{profile?.country ?? "—"}</Row>
            <Button asChild variant="outline" size="sm" className="mt-2 w-full">
              <Link href={`/users/${kyc.user_id}`}>Open player profile</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decision guide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>Verify the photo on the ID matches the selfie. Confirm the ID is not expired and the document number is fully legible.</p>
            <p>Reject blurry, edited, or partially cropped scans with a clear reason — the player gets up to 3 attempts.</p>
            <p>Approval enables withdrawals (R-08); reversing an approval requires escalation.</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ImagePanel title="ID — front" url={frontUrl} />
        <ImagePanel title="ID — back" url={backUrl} optional />
        <ImagePanel title="Selfie" url={selfieUrl} />
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ImagePanel({ title, url, optional }: { title: string; url: string | null; optional?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-normal text-primary underline-offset-2 hover:underline">
              Open full size
            </a>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {url ? (
          <div className="relative aspect-[4/3] w-full bg-muted">
            <Image src={url} alt={title} fill className="object-contain" unoptimized />
          </div>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-muted/40 text-xs text-muted-foreground">
            <FileText className="size-6 opacity-50" />
            {optional ? "Not provided" : "Unable to load image"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
