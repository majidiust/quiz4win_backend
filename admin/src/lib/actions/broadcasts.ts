"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendFcmToTokens, isFcmConfigured } from "@/lib/fcm";

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

  // Resolve target user ids once — used for both recipient count and fan-out.
  let usersQ = db.from("profiles").select("id");
  if (segment_status) usersQ = usersQ.eq("status", segment_status);
  if (segment_kyc_status) usersQ = usersQ.eq("kyc_status", segment_kyc_status);
  const { data: users } = await usersQ.limit(50000);
  const userIds = (users ?? []).map((u) => u.id);
  const recipientsCount = userIds.length;

  const segment: Record<string, string> = {};
  if (segment_status) segment.status = segment_status;
  if (segment_kyc_status) segment.kyc_status = segment_kyc_status;

  const now = new Date().toISOString();
  const isScheduled = !!scheduled_at && scheduled_at > now;

  const { data: bRow, error: bErr } = await db.from("notification_broadcasts").insert({
    title, body, type, segment,
    scheduled_at: scheduled_at ?? null,
    sent_at: isScheduled ? null : now,
    recipients_count: recipientsCount,
    delivered_count: 0,
    failed_count: 0,
    sent_by: admin.id,
    created_at: now,
  }).select("id").maybeSingle();
  if (bErr) return { ok: false, message: bErr.message ?? "Failed to create broadcast" };
  const broadcastId = bRow?.id as string | undefined;

  if (isScheduled) {
    revalidatePath("/notifications");
    return { ok: true, message: "Broadcast scheduled" };
  }

  // In-app inbox rows (schema: `notifications`, column `read`, type CHECK allows 'system'|'promotion').
  if (userIds.length > 0) {
    const rows = userIds.map((uid) => ({
      user_id: uid, type, title, body,
      read: false, sent_via_push: false, broadcast_id: broadcastId ?? null,
      created_at: now,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db.from("notifications").insert(rows.slice(i, i + 500));
    }
  }

  // FCM fan-out — only if configured and we have any recipients.
  let delivered = 0, failed = 0;
  if (userIds.length > 0 && isFcmConfigured()) {
    try {
      const { data: tokens } = await db.from("push_tokens").select("token").in("user_id", userIds);
      const deviceTokens = (tokens ?? []).map((t) => t.token).filter(Boolean);
      if (deviceTokens.length > 0) {
        const res = await sendFcmToTokens(deviceTokens, { title, body, data: { type, broadcast_id: broadcastId ?? "" } });
        delivered = res.delivered; failed = res.failed;
        if (res.invalidTokens.length > 0) {
          await db.from("push_tokens").delete().in("token", res.invalidTokens);
        }
        if (broadcastId) {
          await db.from("notification_broadcasts")
            .update({ delivered_count: delivered, failed_count: failed })
            .eq("id", broadcastId);
        }
      }
    } catch (err) {
      console.error("[broadcasts] fcm error:", (err as Error).message);
    }
  }

  revalidatePath("/notifications");
  const tail = isFcmConfigured()
    ? ` — push delivered to ${delivered} device${delivered === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`
    : " (FCM not configured — inbox only)";
  return { ok: true, message: `Broadcast sent to ${recipientsCount} player${recipientsCount === 1 ? "" : "s"}${tail}` };
}
