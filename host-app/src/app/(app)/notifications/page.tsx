import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/utils";

export const metadata = { title: "Notifications — Quiz4Win Host" };

interface Notification {
  id: string; type: string; title: string; body: string | null;
  read_at?: string | null; created_at: string;
}

export default async function NotificationsPage() {
  const r = await api<{ notifications: Notification[] }>("/notifications");
  const list = r.ok && Array.isArray(r.data?.notifications) ? r.data!.notifications : [];

  return (
    <>
      <PageHeader title="Notifications" />

      {list.length === 0 ? (
        <Card><CardSubtitle>You&apos;re all caught up.</CardSubtitle></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((n) => (
            <Card key={n.id}>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{n.title}</CardTitle>
                <div className="text-[10px] text-[var(--color-q4w-muted)]">{formatRelative(n.created_at)}</div>
              </div>
              {n.body ? <CardSubtitle>{n.body}</CardSubtitle> : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
