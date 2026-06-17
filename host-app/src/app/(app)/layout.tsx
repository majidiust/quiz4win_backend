import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<{ host: { application_status?: string; status?: string } }>("/host/me");

  if (!me.ok) {
    if (me.error === "not_a_host" || me.status === 404) redirect("/onboarding/apply");
    if (me.status === 401) redirect("/signin");
    // Other errors: allow through — individual pages can handle
  } else {
    const appStatus = me.data?.host?.application_status;
    // Only fully-approved hosts can access the main app.
    // Pending / rejected / suspended / unknown → status screen.
    if (appStatus !== "approved") {
      redirect("/onboarding/status");
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[max(env(safe-area-inset-top),12px)]">
      {children}
      <BottomNav />
    </div>
  );
}
