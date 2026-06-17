"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Back button that returns to the actual previous page via browser history.
 * Falls back to `fallback` when there is no history to pop (direct load/refresh).
 */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Back"
      className="glass mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full"
    >
      <ChevronLeft className="h-4 w-4" />
    </button>
  );
}
