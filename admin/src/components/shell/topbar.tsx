"use client";

import { Bell, Search, Command as CmdIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { useCommandPalette } from "./command-palette";
import type { AdminUser } from "@/lib/auth";

export function Topbar({ admin }: { admin: AdminUser }) {
  const { open } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      <div className="flex flex-1 items-center gap-2">
        <Button
          variant="outline"
          onClick={open}
          className="h-9 w-full max-w-md justify-between text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Search className="size-4" />
            Search anything…
          </span>
          <span className="hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] sm:flex">
            <CmdIcon className="size-3" />K
          </span>
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          <Badge
            variant="destructive"
            className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[9px]"
          >
            3
          </Badge>
        </Button>
        <ThemeToggle />
        <div className="mx-1 h-6 w-px bg-border" />
        <UserMenu admin={admin} />
      </div>
    </header>
  );
}
