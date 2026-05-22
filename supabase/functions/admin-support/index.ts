/**
 * Admin Support Edge Function — Quiz4Win
 *
 * GET   /admin/support/tickets              — List all tickets (API #123)
 * GET   /admin/support/tickets/:id         — Ticket detail (API #124)
 * POST  /admin/support/tickets/:id/reply   — Reply (API #125)
 * PATCH /admin/support/tickets/:id/assign  — Assign (API #126)
 * PATCH /admin/support/tickets/:id/status  — Update status (API #127)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/support\/tickets\/?/, "").split("/").filter(Boolean);
  const ticketId = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "support"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/support/tickets
    if (!ticketId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const status = url.searchParams.get("status");
      const priority = url.searchParams.get("priority");
      const assignedTo = url.searchParams.get("assigned_to");
      const offset = (page - 1) * limit;

      let query = admin.from("support_tickets").select("id, ticket_number, subject, category, status, priority, user_id, assigned_to, created_at, updated_at, profiles!user_id(name, email)", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      if (priority) query = query.eq("priority", priority);
      if (assignedTo) query = query.eq("assigned_to", assignedTo);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to list tickets", 500);
      return successResponse({ tickets: data ?? [], pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /admin/support/tickets/:id
    if (ticketId && !action && req.method === "GET") {
      const [ticketRes, messagesRes] = await Promise.all([
        admin.from("support_tickets").select("*, profiles!user_id(name, email)").eq("id", ticketId).single(),
        admin.from("support_ticket_messages").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true }),
      ]);
      if (ticketRes.error || !ticketRes.data) return errorResponse("ticket_not_found", 404);
      return successResponse({ ticket: ticketRes.data, messages: messagesRes.data ?? [] });
    }

    // POST /admin/support/tickets/:id/reply
    if (ticketId && action === "reply" && req.method === "POST") {
      const { message } = await req.json();
      if (!message) return errorResponse("message is required", 400);

      const { error } = await admin.from("support_ticket_messages").insert({ ticket_id: ticketId, sender_type: "admin", sender_id: user.id, message, created_at: new Date().toISOString() });
      if (error) return errorResponse(sanitizeError(error), 500);

      // Update ticket timestamp and status to in_progress if it was open
      await admin.from("support_tickets").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", ticketId).eq("status", "open");
      return successResponse({ message: "Reply sent" }, 201);
    }

    // PATCH /admin/support/tickets/:id/assign
    if (ticketId && action === "assign" && req.method === "PATCH") {
      const { admin_id } = await req.json();
      if (!admin_id) return errorResponse("admin_id is required", 400);

      const { error } = await admin.from("support_tickets").update({ assigned_to: admin_id, updated_at: new Date().toISOString() }).eq("id", ticketId);
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ message: "Ticket assigned" });
    }

    // PATCH /admin/support/tickets/:id/status
    if (ticketId && action === "status" && req.method === "PATCH") {
      const { status } = await req.json();
      const valid = ["open", "in_progress", "resolved", "closed"];
      if (!status || !valid.includes(status)) return errorResponse(`status must be one of: ${valid.join(", ")}`, 400);

      const { error } = await admin.from("support_tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", ticketId);
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ message: `Ticket status updated to ${status}` });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-support] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
