import { ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { ProfileForm, PasswordForm } from "./profile-form";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const admin = await requireAdmin();

  return (
    <>
      <PageHeader
        title="Your profile"
        description="Update your display name, password, and multi-factor authentication."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Email</div>
            <div className="text-sm font-medium break-all">{admin.email}</div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Role</div>
            <Badge variant="muted">{admin.role.replace("_", " ")}</Badge>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Last sign-in</div>
            <div className="text-sm">{formatDateTime(admin.last_login_at)}</div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Multi-factor auth</div>
            <div className="flex items-center justify-between gap-2">
              {admin.mfa_enabled ? (
                <Badge variant="success" className="gap-1">
                  <ShieldCheck className="size-3" /> Enabled
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1">
                  <ShieldAlert className="size-3" /> Not enabled
                </Badge>
              )}
              <Link
                href="/profile/mfa"
                className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {admin.mfa_enabled ? "Manage" : "Enable"}
              </Link>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Display name</h2>
          <p className="mt-1 text-sm text-muted-foreground">Shown across the admin panel and in audit logs.</p>
          <div className="mt-4">
            <ProfileForm currentName={admin.name} />
          </div>
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h2 className="text-base font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm your current password, then choose a new one with at least 8 characters.
          </p>
          <div className="mt-4 max-w-md">
            <PasswordForm />
          </div>
        </Card>
      </div>
    </>
  );
}
