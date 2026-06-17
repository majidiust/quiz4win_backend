"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Search, UserCheck, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listApprovedHosts, type ApprovedHostRow } from "@/lib/actions/hosts";

export interface SelectedHost {
  id: string;
  name: string;
}

interface Props {
  /** Currently-selected host (so we can highlight it on open). */
  value: SelectedHost | null;
  onChange: (host: SelectedHost | null) => void;
  /** Optional custom trigger; when omitted a default button is rendered. */
  trigger?: React.ReactNode;
  /** Forces the trigger button width — used inside form grids. */
  buttonFull?: boolean;
}

export function HostPickerDialog({ value, onChange, trigger, buttonFull = true }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ApprovedHostRow[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    start(async () => {
      try {
        const r = await listApprovedHosts(q.trim() || undefined, 50);
        if (!r.ok) {
          setErr(r.error ? `Failed to load hosts: ${r.error}` : "Failed to load hosts");
          return;
        }
        setItems(r.hosts);
      } catch (e) {
        setErr((e as Error).message ?? "Failed to load hosts");
      }
    });
  }, [open, q]);

  function pick(h: ApprovedHostRow) {
    onChange({ id: h.id, name: h.name });
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setOpen(false);
  }

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={buttonFull ? "w-full justify-start" : undefined}
    >
      <UserCheck className="size-4" />
      <span className="truncate">{value ? value.name : "Assign a host…"}</span>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign a host</DialogTitle>
          <DialogDescription>
            Pick an approved, active host. Schedule conflicts are checked at save-time.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name…"
            className="pl-9"
            autoFocus
          />
        </div>

        {err ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {err}
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {pending && items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {q ? (
                <>No hosts match &quot;{q}&quot;.</>
              ) : (
                <>
                  No approved hosts yet.{" "}
                  <Link href="/host-applications" className="text-primary underline">
                    Review applications →
                  </Link>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((h) => {
                const selected = value?.id === h.id;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => pick(h)}
                      className={
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-accent/40 " +
                        (selected ? "bg-accent/60" : "")
                      }
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={h.avatar_url ?? undefined} />
                        <AvatarFallback>{h.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{h.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[h.country, (h.languages ?? []).join(", "), h.shows_hosted != null ? `${h.shows_hosted} shows` : null]
                            .filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {selected ? <UserCheck className="size-4 text-primary" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear} className="mr-auto text-muted-foreground">
              <X className="size-4" /> Unassign
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
