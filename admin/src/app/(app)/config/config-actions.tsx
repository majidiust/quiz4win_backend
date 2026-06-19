"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateConfigKey, toggleMaintenanceMode, toggleHostApplications } from "@/lib/actions/config";

/* ------------------------------------------------------------------ */
/* Inline editable config row                                           */
/* ------------------------------------------------------------------ */
export function ConfigValueCell({ configKey, value }: { configKey: string; value: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();

  function save() {
    if (draft === value) { setEditing(false); return; }
    start(async () => {
      const res = await updateConfigKey(configKey, draft);
      if (res.ok) {
        toast.success(res.message);
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="font-mono text-xs truncate max-w-xs">{value}</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-7 text-xs font-mono w-64"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
        autoFocus
      />
      <Button size="icon" variant="ghost" className="size-7" loading={pending} onClick={save}>
        <Check className="size-3.5 text-green-600" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" onClick={cancel}>
        <X className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host applications toggle                                             */
/* ------------------------------------------------------------------ */
export function HostApplicationsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();

  function toggle(val: boolean) {
    setChecked(val);
    start(async () => {
      const res = await toggleHostApplications(val);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
        setChecked(!val); // rollback
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4 mb-2">
      <div className="flex-1">
        <p className="text-sm font-medium">Host Applications</p>
        <p className="text-xs text-muted-foreground">
          When disabled, users cannot apply to become hosts. The mobile app reads this flag from{" "}
          <span className="font-mono">GET /config/app</span> and hides the &ldquo;Become a Host&rdquo; entry point.
        </p>
      </div>
      <Switch
        id="host-applications-toggle"
        checked={checked}
        onCheckedChange={toggle}
        disabled={pending}
      />
      <Label htmlFor="host-applications-toggle" className="sr-only">Toggle host applications</Label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance mode toggle                                              */
/* ------------------------------------------------------------------ */
export function MaintenanceModeToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();

  function toggle(val: boolean) {
    setChecked(val);
    start(async () => {
      const res = await toggleMaintenanceMode(val);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
        setChecked(!val); // rollback
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4 mb-4">
      <div className="flex-1">
        <p className="text-sm font-medium">Maintenance Mode</p>
        <p className="text-xs text-muted-foreground">
          When enabled, the app shows a maintenance screen to all players.
        </p>
      </div>
      <Switch
        id="maintenance-toggle"
        checked={checked}
        onCheckedChange={toggle}
        disabled={pending}
      />
      <Label htmlFor="maintenance-toggle" className="sr-only">Toggle maintenance mode</Label>
    </div>
  );
}
