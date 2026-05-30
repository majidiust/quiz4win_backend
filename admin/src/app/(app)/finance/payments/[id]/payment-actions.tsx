"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reconcilePayment } from "@/lib/actions/finance";

interface Props {
  id: string;
  status: string;
}

const TERMINAL_STATES = new Set(["failed", "cancelled", "expired"]);

export function PaymentActions({ id, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Allow re-querying the gateway for any non-succeeded payment. Terminal
  // states (failed/cancelled/expired) can also be re-checked in case the
  // upstream provider state has changed since we last polled.
  const canVerify = status !== "succeeded";
  const isTerminal = TERMINAL_STATES.has(status);

  function handleVerify() {
    startTransition(async () => {
      try {
        const res = await reconcilePayment({ id });
        if (res.ok) {
          toast.success(res.message);
          router.refresh();
        } else {
          toast.error(res.message);
        }
      } catch (err) {
        toast.error("An unexpected error occurred");
        console.error(err);
      }
    });
  }

  if (!canVerify) return null;

  return (
    <Button
      variant={isTerminal ? "outline" : "default"}
      size="sm"
      onClick={handleVerify}
      disabled={pending}
    >
      <RefreshCw className={`mr-2 size-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Verifying…" : isTerminal ? "Re-check with gateway" : "Verify with gateway"}
    </Button>
  );
}
