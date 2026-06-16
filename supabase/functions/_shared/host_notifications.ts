/**
 * Host-platform notification helper.
 *
 * Inserts a row into public.notifications scoped to the host's auth user.
 * Always best-effort: any insert failure is logged but never thrown, so the
 * primary admin/host action that triggered the notification still succeeds.
 *
 * Allowed types are gated by the DB CHECK constraint installed in migration
 * 20260609000200_host_platform_notification_types.sql.
 */

// deno-lint-ignore no-explicit-any
type DB = any;

export type HostNotificationType =
  | "host_application"
  | "host_invite"
  | "host_request"
  | "host_earning"
  | "host_payment_method"
  | "host_file"
  | "host_stream";

export interface HostNotificationInput {
  hostId: string;          // public.show_hosts.id
  type: HostNotificationType;
  title: string;           // <= 120 chars suggested
  body: string;            // user-facing copy
  data?: Record<string, unknown> | null;
}

/**
 * Resolves host_id → auth_user_id and inserts a notifications row.
 * Returns the inserted row id or null on failure.
 *
 * Note: notifications.user_id has an FK to profiles(id) (= auth.users.id),
 * so we must look up show_hosts.auth_user_id rather than passing host_id.
 * Hosts created admin-side without a linked auth user are skipped silently.
 */
export async function notifyHost(db: DB, input: HostNotificationInput): Promise<string | null> {
  try {
    const { data: host } = await db
      .from("show_hosts")
      .select("auth_user_id")
      .eq("id", input.hostId)
      .maybeSingle();

    const authUserId = (host as { auth_user_id?: string } | null)?.auth_user_id ?? null;
    if (!authUserId) {
      // Admin-managed host with no self-service account — nothing to notify.
      return null;
    }

    const { data, error } = await db
      .from("notifications")
      .insert({
        user_id: authUserId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        data: input.data ?? null,
        read: false,
        sent_via_push: false,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.warn(`[host_notify] insert failed type=${input.type} host=${input.hostId}: ${error.message}`);
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    console.warn(`[host_notify] threw: ${(e as Error).message}`);
    return null;
  }
}

/** Convenience: render a money amount for notification body copy. */
export function formatAmount(amount: unknown, currency = "USD"): string {
  const n = typeof amount === "string" ? Number(amount) : Number(amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
