"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Gamepad2, Mail, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/invitations", label: "Invites", icon: Mail },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/settings", label: "Profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      className="glass fixed inset-x-3 bottom-3 z-20 mx-auto flex max-w-md items-center justify-around rounded-full px-2 py-2 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.55)]"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-2 text-[10px]",
              active
                ? "text-[var(--color-q4w-text)]"
                : "text-[var(--color-q4w-muted)]",
            )}
          >
            <Icon className={cn("h-5 w-5", active && "text-[var(--color-q4w-primary)]")} strokeWidth={active ? 2.4 : 1.8} />
            <span className={cn(active && "font-medium")}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
