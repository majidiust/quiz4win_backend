import { api } from "@/lib/api";
import { redirect } from "next/navigation";
import ApplyWizard from "./wizard";

export const metadata = { title: "Complete your profile — Quiz4Win Host" };

export default async function ApplyPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; closed?: string }> }) {
  const sp = await searchParams;
  const me = await api<{ host: Record<string, unknown> }>("/host/me");
  if (me.ok && me.data?.host) {
    const h = me.data.host as { application_status?: string };
    if (h.application_status === "approved") redirect("/dashboard");
    if (h.application_status === "pending") redirect("/onboarding/status");
  }

  // Feature flag is off — show a clear informational state instead of the wizard
  // so users don't waste time filling out the form only to be rejected at submit.
  if (sp.closed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
        <h1 className="text-2xl font-semibold">Applications are closed</h1>
        <p className="mt-3 text-sm text-[var(--color-q4w-muted)]">
          Host applications are not currently open. Please check back later.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      <h1 className="text-2xl font-semibold">Tell us about you</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        Complete your host profile. Admins will review and approve your application.
      </p>

      <ApplyWizard initialError={sp.error} />
    </main>
  );
}
