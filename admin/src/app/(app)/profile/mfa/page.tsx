import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth";
import { MfaSetup } from "./mfa-setup";

export const metadata = { title: "Multi-factor authentication" };

export default async function MfaPage() {
  const admin = await requireAdmin();

  return (
    <>
      <PageHeader
        title="Multi-factor authentication"
        description="Add a time-based one-time password (TOTP) factor to your account."
      />

      <Card className="p-5">
        <MfaSetup initialEnabled={admin.mfa_enabled} />
      </Card>
    </>
  );
}
