import { Badge } from "@/components/ui/badge";

type Tone = "default" | "secondary" | "destructive" | "success" | "warning" | "outline" | "muted";

const TONES: Record<string, Tone> = {
  // generic
  active: "success",
  inactive: "muted",
  disabled: "destructive",
  suspended: "warning",
  banned: "destructive",
  // kyc & moderation
  pending: "warning",
  verified: "success",
  rejected: "destructive",
  accepted: "success",
  unassigned: "muted",
  // games
  upcoming: "secondary",
  open: "secondary",
  live: "success",
  completed: "muted",
  cancelled: "destructive",
  // finance
  awaiting_confirmation: "secondary",
  processing: "warning",
  failed: "destructive",
  // support
  in_progress: "warning",
  resolved: "success",
  closed: "muted",
};

export function StatusBadge({
  value,
  label,
  className,
}: {
  value: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = TONES[value.toLowerCase()] ?? "outline";
  return (
    <Badge variant={tone} className={className}>
      {label ?? value.replace(/_/g, " ")}
    </Badge>
  );
}

/** Friendly labels for a game's `host_assignment_status`. */
export function hostAssignmentLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending": return "Pending host confirmation";
    case "accepted": return "Accepted";
    case "rejected": return "Rejected";
    case "unassigned": return "Unassigned";
    default: return status ?? "Unassigned";
  }
}
