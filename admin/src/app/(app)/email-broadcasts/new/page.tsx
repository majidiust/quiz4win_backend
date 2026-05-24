import { PageHeader } from "@/components/shell/page-header";
import { EmailBroadcastForm } from "../email-broadcast-form";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "New Email Broadcast" };

export default async function NewEmailBroadcastPage() {
  await requireAdmin(["super_admin", "admin"]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Compose Broadcast"
        description="Create a new bulk email campaign. You can save as draft and send later."
      />
      <EmailBroadcastForm />
    </div>
  );
}
