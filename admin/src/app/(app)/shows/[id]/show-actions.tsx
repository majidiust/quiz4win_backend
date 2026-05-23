"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startShow, endShow, advanceShowQuestion } from "@/lib/actions/shows";

interface Props { showId: string; status: string }

export function ShowLifecycleActions({ showId, status }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {["upcoming", "open"].includes(status) && (
        <Button size="sm" onClick={() => run(() => startShow(showId))} loading={pending}>
          <Play className="size-3.5" /> Go live
        </Button>
      )}
      {status === "live" && (
        <>
          <Button size="sm" variant="outline" onClick={() => run(() => advanceShowQuestion(showId))} loading={pending}>
            <ChevronRight className="size-3.5" /> Next question
          </Button>
          <Button size="sm" variant="destructive" onClick={() => run(() => endShow(showId))} loading={pending}>
            <Square className="size-3.5" /> End show
          </Button>
        </>
      )}
    </div>
  );
}
