"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setTemplateActive, deleteTemplate, generateNow } from "@/lib/actions/templates";

interface Props {
  id: string;
  isActive: boolean;
}

export function TemplateActions({ id, isActive }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => {
          const res = await generateNow(id, false);
          if (res.ok) {
            toast.success(res.message);
            if (res.game_id) router.push(`/games/${res.game_id}`);
            else router.refresh();
          } else {
            toast.error(res.message);
          }
        })}
      >
        <Play className="size-3.5" /> Generate now
      </Button>

      {isActive ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await setTemplateActive(id, false);
            if (res.ok) { toast.success(res.message); router.refresh(); }
            else toast.error(res.message);
          })}
        >
          <PowerOff className="size-3.5" /> Deactivate
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await setTemplateActive(id, true);
            if (res.ok) { toast.success(res.message); router.refresh(); }
            else toast.error(res.message);
          })}
        >
          <Power className="size-3.5" /> Activate
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              The template will be soft-deleted and deactivated. Existing games generated from it are not removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => start(async () => {
                const res = await deleteTemplate(id);
                if (res.ok) {
                  toast.success(res.message);
                  router.push("/templates");
                } else {
                  toast.error(res.message);
                }
              })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
