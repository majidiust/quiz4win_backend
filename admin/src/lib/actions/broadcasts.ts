"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

const BroadcastSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  type: z.enum(["system", "promotion"]),
  segment_status: z.string().optional(),
  segment_kyc_status: z.string().optional(),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
});

export async function sendBroadcast(input: z.infer<typeof BroadcastSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = BroadcastSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { title, body, type, segment_status, segment_kyc_status, scheduled_at } = parsed.data;
  const db = createSupabaseAdminClient();

  // Count target recipients
  let userQuery = db.from("profiles").select("id", { count: "exact", head: true });
  if (segment_status) userQuery = userQuery.eq("status", segment_status);
  if (segment_kyc_status) userQuery = userQuery.eq("kyc_status", segment_kyc_status);
  const { count: recipientsCount } = await userQuery;

  const segment: Record<string, string> = {};
  if (segment_status) segment.status = segment_status;
  if (segment_kyc_status) segment.kyc_status = segment_kyc_status;

  const now = new Date().toISOString();
  const isScheduled = !!scheduled_at && scheduled_at > now;

  const { error } = await db.from("notification_broadcasts").insert({
    title,
    body,
    type,
    segment,
    scheduled_at: scheduled_at ?? null,
    sent_at: isScheduled ? null : now,
    recipients_count: recipientsCount ?? 0,
    delivered_count: 0,
    failed_count: 0,
    sent_by: admin.id,
    created_at: now,
  });
  if (error) return { ok: false, message: error.message ?? "Failed to send broadcast" };

  // Fan-out in-app notifications immediately (not scheduled)
  if (!isScheduled) {
    let usersQ = db.from("profiles").select("id");
    if (segment_status) usersQ = usersQ.eq("status", segment_status);
    if (segment_kyc_status) usersQ = usersQ.eq("kyc_status", segment_kyc_status);
    const { data: users } = await usersQ.limit(5000);
    if (users && users.length > 0) {
      const rows = users.map((u) => ({
        user_id: u.id,
        type,
        title,
        body,
        is_read: false,
        created_at: now,
      }));
      // Batch insert in chunks of 500
      for (let i = 0; i < rows.length; i += 500) {
        await db.from("admin_notifications").insert(rows.slice(i, i + 500));
      }
    }
  }

  revalidatePath("/notifications");
  return { ok: true, message: isScheduled ? "Broadcast scheduled" : `Broadcast sent to ${recipientsCount ?? 0} players` };
}
