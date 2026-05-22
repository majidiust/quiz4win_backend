"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, User, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { initials } from "@/lib/utils";
import type { AdminUser } from "@/lib/auth";

export function UserMenu({ admin }: { admin: AdminUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      toast.success("Signed out");
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/15 text-primary">{initials(admin.name ?? admin.email)}</AvatarFallback>
          </Avatar>
          <div className="hidden text-left lg:block">
            <div className="text-sm font-medium leading-tight">{admin.name ?? admin.email}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{admin.role.replace("_", " ")}</div>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="truncate">{admin.email}</span>
          <Badge variant="muted" className="ml-2 text-[10px]">{admin.role}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <User className="mr-2 size-4" /> Profile
        </DropdownMenuItem>
        {!admin.mfa_enabled ? (
          <DropdownMenuItem onClick={() => router.push("/profile/mfa")}>
            <ShieldAlert className="mr-2 size-4 text-warning" /> Enable MFA
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} disabled={signingOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
