"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarPickerSection } from "@/app/(app)/settings/avatar-picker";
import { Button } from "@/components/ui/button";

interface Props {
  currentUrl: string | null;
  name: string;
  uploadToken: string | null;
}

export function OnboardingAvatarClient({ currentUrl, name, uploadToken }: Props) {
  const [hasAvatar, setHasAvatar] = useState(!!currentUrl);
  const router = useRouter();

  return (
    <div className="flex flex-col items-center gap-8">
      <AvatarPickerSection
        currentUrl={currentUrl}
        name={name}
        uploadToken={uploadToken}
        onChanged={() => setHasAvatar(true)}
      />

      <div className="w-full space-y-3">
        {!hasAvatar && (
          <p className="text-center text-xs text-white/45">
            Please add a profile photo to continue.
          </p>
        )}
        <Button
          type="button"
          onClick={() => router.push("/onboarding/intro-video")}
          disabled={!hasAvatar}
          className="w-full"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
