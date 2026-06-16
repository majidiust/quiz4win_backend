import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<{ host: Record<string, unknown> }>("/host/me");
  if (!me.ok) {
    if (me.error === "not_a_host" || me.status === 404) redirect("/onboarding/apply");
    if (me.status === 401) redirect("/signin");
  }
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[max(env(safe-area-inset-top),12px)]">
      {children}
      <BottomNav />
    </div>
  );
}
