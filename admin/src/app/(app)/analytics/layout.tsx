import Link from "next/link";
import { Banknote, Gamepad2, LineChart, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";

const TABS = [
  { href: "/analytics/revenue", label: "Revenue", icon: LineChart },
  { href: "/analytics/users", label: "Users", icon: Users },
  { href: "/analytics/games", label: "Games", icon: Gamepad2 },
  { href: "/analytics/finance", label: "Finance", icon: Banknote },
];

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
