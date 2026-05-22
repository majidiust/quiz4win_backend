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
  // games
  upcoming: "secondary",
  open: "secondary",
  live: "success",
  completed: "muted",
  cancelled: "destructive",
  // finance
  processing: "warning",
  failed: "destructive",
  // support
  in_progress: "warning",
  resolved: "success",
  closed: "muted",
};

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = TONES[value.toLowerCase()] ?? "outline";
  return (
    <Badge variant={tone} className={className}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}
