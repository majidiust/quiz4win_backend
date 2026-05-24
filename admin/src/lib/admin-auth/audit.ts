import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Append a row to admin_audit_log. Failure is logged but never thrown — an
 * audit-log outage must not block the originating admin action.
 */
export async function audit(
  adminId: string,
  action: string,
  entityId: string | null = null,
  details: Record<string, unknown> | null = null,
  ipAddress: string | null = null,
): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    entity_id: entityId,
    details,
    ip_address: ipAddress,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[audit] insert failed:", error.message);
}

/** Best-effort client IP extraction from the incoming request. */
export function ipFromRequest(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? null;
}
