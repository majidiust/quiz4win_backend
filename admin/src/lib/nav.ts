import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Gamepad2,
  Radio,
  BookOpen,
  Wallet,
  Banknote,
  CreditCard,
  AlertOctagon,
  LifeBuoy,
  Megaphone,
  Bell,
  Ticket,
  Link2,
  Settings2,
  History,
  UserCog,
  Video,
  LineChart,
  KeyRound,
  Star,
  Smartphone,
  CalendarClock,
  BrainCircuit,
  Music2,
  ListChecks,
} from "lucide-react";
import type { AdminRole } from "./auth";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  roles?: AdminRole[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Analytics", href: "/analytics/revenue", icon: LineChart, roles: ["super_admin", "admin", "finance"] },
    ],
  },
  {
    title: "Players",
    items: [
      { title: "Users", href: "/users", icon: Users, roles: ["super_admin", "admin", "support"] },
      { title: "KYC Queue", href: "/kyc", icon: ShieldCheck, roles: ["super_admin", "admin", "support"] },
    ],
  },
  {
    title: "Content",
    items: [
      { title: "Games", href: "/games", icon: Gamepad2, roles: ["super_admin", "admin", "moderator"] },
      { title: "Game Templates", href: "/templates", icon: CalendarClock, roles: ["super_admin", "admin", "moderator"] },
      { title: "LLM Templates", href: "/llm-templates", icon: BrainCircuit, roles: ["super_admin", "admin"] },
      { title: "Live Shows", href: "/shows", icon: Radio, roles: ["super_admin", "admin", "moderator"] },
      { title: "Host Applications", href: "/host-applications", icon: Star, roles: ["super_admin", "admin", "moderator"] },
      { title: "Hosts",              href: "/hosts",             icon: UserCog, roles: ["super_admin", "admin", "moderator", "finance"] },
      { title: "Host Requests",      href: "/host-requests",     icon: ListChecks, roles: ["super_admin", "admin", "moderator"] },
      { title: "Early Birds", href: "/early-birds", icon: Smartphone, roles: ["super_admin", "admin", "moderator"] },
      { title: "LiveKit Rooms", href: "/livekit", icon: Video, roles: ["super_admin", "admin"] },
      { title: "Questions", href: "/questions", icon: BookOpen, roles: ["super_admin", "admin", "moderator"] },
      { title: "Sounds", href: "/sounds", icon: Music2, roles: ["super_admin", "admin"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { title: "Payments", href: "/finance/payments", icon: CreditCard, roles: ["super_admin", "admin", "finance"] },
      { title: "Withdrawals", href: "/finance/withdrawals", icon: Wallet, roles: ["super_admin", "admin", "finance"] },
      { title: "Host Payouts", href: "/finance/host-withdrawals", icon: Banknote, roles: ["super_admin", "admin", "finance"] },
      { title: "Transactions", href: "/finance/transactions", icon: Banknote, roles: ["super_admin", "admin", "finance"] },
      { title: "AML Flags", href: "/finance/aml", icon: AlertOctagon, roles: ["super_admin", "admin", "finance"] },
    ],
  },
  {
    title: "Engagement",
    items: [
      { title: "Support Tickets", href: "/support", icon: LifeBuoy, roles: ["super_admin", "admin", "support"] },
      { title: "Push Broadcasts", href: "/notifications", icon: Megaphone, roles: ["super_admin", "admin"] },
      { title: "Email Broadcasts", href: "/email-broadcasts", icon: Bell, roles: ["super_admin", "admin"] },
      { title: "Vouchers", href: "/vouchers", icon: Ticket, roles: ["super_admin", "admin"] },
      { title: "Referrals", href: "/referrals", icon: Link2, roles: ["super_admin", "admin"] },
    ],
  },
  {
    title: "System",
    items: [
      { title: "App Config", href: "/config", icon: Settings2, roles: ["super_admin", "admin"] },
      { title: "Admin Users", href: "/admins", icon: UserCog, roles: ["super_admin"] },
      { title: "API Keys", href: "/api-keys", icon: KeyRound, roles: ["super_admin"] },
      { title: "Audit Log", href: "/audit", icon: History, roles: ["super_admin"] },
    ],
  },
];

export function filterNavByRole(role: AdminRole): NavSection[] {
  return navSections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => !i.roles || i.roles.includes(role)),
    }))
    .filter((s) => s.items.length > 0);
}
