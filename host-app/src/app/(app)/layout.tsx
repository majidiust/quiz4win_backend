import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { BottomNav } from "@/components/bottom-nav";

interface OnboardingState {
  email_verified: boolean;
  has_application: boolean;
  onboarding_complete: boolean;
  application_status: string | null;
  host_status: string | null;
  /** Canonical next route for this user — "/dashboard" means fully cleared. */
  next: string;
}

/**
 * Gate for all (app) pages (dashboard, games, invitations, wallet, …).
 *
 * Enforces the full three-condition access rule in order:
 *   1. Email verified
 *   2. Onboarding completed (profile submitted + intro video uploaded)
 *   3. Admin-approved (application_status === "approved" and not suspended)
 *
 * The authoritative state comes from GET /host/onboarding-state so the logic
 * is never split between frontend and backend.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await api<OnboardingState>("/host/onboarding-state");

  if (!state.ok) {
    // 401 = no valid session; any other backend error → force re-login.
    redirect("/signin");
  }

  const { next } = state.data;

  // "/dashboard" is the sentinel value meaning all three conditions are met.
  // Any other value means the user should be elsewhere.
  if (next !== "/dashboard") {
    redirect(next);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[max(env(safe-area-inset-top),12px)]">
      {children}
      <BottomNav />
    </div>
  );
}
