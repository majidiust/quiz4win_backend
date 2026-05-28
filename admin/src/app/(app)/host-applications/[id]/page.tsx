import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, AtSign, Globe, BarChart2, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { ApplicationActions } from "./application-actions";

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data } = await db.from("host_applications").select("name").eq("id", id).single();
  return { title: data ? `${data.name} — Host Application` : "Host Application" };
}

export default async function HostApplicationDetailPage({ params }: Props) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: app, error } = await db
    .from("host_applications")
    .select("id, name, email, country, instagram, followers, status, admin_notes, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !app) notFound();

  return (
    <>
      <div className="mb-4">
        <Link href="/host-applications" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Host Applications
        </Link>
      </div>

      <PageHeader
        title={app.name}
        description={app.email}
        actions={<ApplicationActions applicationId={app.id} currentStatus={app.status} adminNotes={app.admin_notes ?? ""} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Applicant details */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="size-4" />Applicant Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Name</dt>
                <dd className="text-sm font-medium">{app.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Email</dt>
                <dd className="text-sm">{app.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Globe className="size-3" /> Country
                </dt>
                <dd className="text-sm">{app.country ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <AtSign className="size-3" /> Instagram
                </dt>
                <dd className="text-sm">
                  {app.instagram ? (
                    <a
                      href={`https://instagram.com/${(app.instagram as string).replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      @{(app.instagram as string).replace(/^@/, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <BarChart2 className="size-3" /> Followers
                </dt>
                <dd className="text-sm">
                  {app.followers != null ? formatNumber(app.followers as number) : <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <CalendarClock className="size-3" /> Applied
                </dt>
                <dd className="text-sm text-muted-foreground">{formatDateTime(app.created_at as string)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Status & notes */}
        <Card>
          <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Current status</p>
              <StatusBadge value={app.status as string} />
            </div>
            {app.admin_notes && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Admin notes</p>
                <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{app.admin_notes as string}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Last updated</p>
              <p className="text-xs">{formatDateTime(app.updated_at as string)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
