"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Reply                                                                */
/* ------------------------------------------------------------------ */

const ReplySchema = z.object({
  ticketId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
});

export async function replyToTicket(input: z.infer<typeof ReplySchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = ReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { ticketId, content } = parsed.data;
  const db = createSupabaseAdminClient();

  const { error } = await db.from("support_ticket_messages").insert({
    ticket_id: ticketId,
    sender_type: "admin",
    sender_id: admin.id,
    content,
    created_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Failed to send reply" };

  // Auto-move to in_progress if currently open
  await db
    .from("support_tickets")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("status", "open");

  revalidatePath(`/support/${ticketId}`);
  return { ok: true, message: "Reply sent" };
}

/* ------------------------------------------------------------------ */
/* Assign                                                               */
/* ------------------------------------------------------------------ */

const AssignSchema = z.object({
  ticketId: z.string().uuid(),
  assigneeId: z.string().uuid().nullable(),
});

export async function assignTicket(input: z.infer<typeof AssignSchema>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { ticketId, assigneeId } = parsed.data;
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("support_tickets")
    .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  if (error) return { ok: false, message: "Failed to assign ticket" };

  revalidatePath(`/support/${ticketId}`);
  revalidatePath("/support");
  return { ok: true, message: assigneeId ? "Ticket assigned" : "Ticket unassigned" };
}

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */

const TicketStatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
});

export async function updateTicketStatus(input: z.infer<typeof TicketStatusSchema>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = TicketStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { ticketId, status } = parsed.data;
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("support_tickets")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  if (error) return { ok: false, message: "Failed to update status" };

  revalidatePath(`/support/${ticketId}`);
  revalidatePath("/support");
  return { ok: true, message: `Ticket marked as ${status.replace(/_/g, " ")}` };
}
