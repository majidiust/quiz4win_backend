import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUploadToken } from "@/app/(app)/settings/actions";
import { OnboardingAvatarClient } from "./client";

export const metadata = { title: "Profile Photo — Quiz4Win Host" };

interface Host {
  name: string;
  avatar_url: string | null;
}

export default async function OnboardingAvatarPage() {
  const [meResult, uploadToken] = await Promise.all([
    api<{ host: Host }>("/host/me"),
    getUploadToken(),
  ]);

  if (!meResult.ok) {
    if (meResult.status === 401) redirect("/signin");
    redirect("/onboarding/apply");
  }

  const host = meResult.data?.host;
  if (!host) redirect("/onboarding/apply");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      {/* Header */}
      <div className="mb-8 text-center">
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
          Step 2 of 3 — Profile Photo
        </p>
        <h1 className="text-2xl font-bold">Add a profile photo</h1>
        <p className="mt-2 text-sm text-white/50">
          Your photo helps viewers recognise you as their host.
          Choose one of our 3-D avatars or upload your own.
        </p>
      </div>

      <OnboardingAvatarClient
        currentUrl={host.avatar_url}
        name={host.name}
        uploadToken={uploadToken}
      />
    </main>
  );
}
