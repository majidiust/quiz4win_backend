"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setActiveLlmTemplate, deleteLlmTemplate } from "@/lib/actions/llm-templates";

interface Props {
  id: string;
  isActive: boolean;
}

export function LlmTemplateActions({ id, isActive }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      {!isActive && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await setActiveLlmTemplate(id);
            if (res.ok) { toast.success(res.message); router.refresh(); }
            else toast.error(res.message);
          })}
        >
          <Power className="size-3.5" /> Set default
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending} className="text-destructive hover:text-destructive">
            <Trash2 className="size-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete LLM template?</AlertDialogTitle>
            <AlertDialogDescription>
              The template will be soft-deleted and deactivated. Games or game
              templates pointing to it fall back to the global default (or the
              built-in generator prompt). This cannot be undone from the panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => start(async () => {
                const res = await deleteLlmTemplate(id);
                if (res.ok) { toast.success(res.message); router.refresh(); }
                else toast.error(res.message);
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
