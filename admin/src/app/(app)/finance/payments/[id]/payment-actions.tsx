"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reconcilePayment } from "@/lib/actions/finance";

interface Props {
  id: string;
  status: string;
}

export function PaymentActions({ id, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const canVerify = ["pending", "init"].includes(status);

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

  return (
    <div className="flex items-center gap-2">
      {canVerify ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerify}
          disabled={pending}
        >
          <RefreshCw className={`mr-2 size-4 ${pending ? "animate-spin" : ""}`} />
          Re-verify status
        </Button>
      ) : null}
    </div>
  );
}
