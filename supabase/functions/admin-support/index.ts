/**
 * Admin Support Edge Function — Quiz4Win
 *
 * GET   /admin/support/tickets              — List all tickets (API #123)
 * GET   /admin/support/tickets/:id         — Ticket detail (API #124)
 * POST  /admin/support/tickets/:id/reply   — Reply (API #125)
 * PATCH /admin/support/tickets/:id/assign  — Assign (API #126)
 * PATCH /admin/support/tickets/:id/status  — Update status (API #127)
 * GET   /admin/support/stats               — Ticket stats by status/category (row 148)
 * GET   /admin/support/tickets/export      — Tickets CSV (row 151)
 * POST  /admin/support/tickets/bulk-assign  — Bulk assign tickets (row 150)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const isStats = url.pathname.endsWith("/admin/support/stats");
  const parts = url.pathname.replace(/^\/admin\/support\/tickets\/?/, "").split("/").filter(Boolean);
  const ticketId = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "support"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // POST /admin/support/tickets/bulk-assign — bulk assign (row 150)
    if (ticketId === "bulk-assign" && !action && req.method === "POST") {
      const { ticket_ids, admin_id } = await req.json();
      if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) return errorResponse("ticket_ids array is required", 400);
      if (!admin_id) return errorResponse("admin_id is required", 400);
      if (ticket_ids.length > 200) return errorResponse("Maximum 200 tickets per batch", 400);

      const { error } = await admin.from("support_tickets").update({ assigned_to: admin_id, updated_at: new Date().toISOString() }).in("id", ticket_ids);
      if (error) return errorResponse(sanitizeError(error), 500);

      const auditRows = ticket_ids.map((id: string) => ({ admin_id: user.id, action: "support_ticket_assigned", target_type: "support_ticket", target_id: id, details: { assigned_to: admin_id, batch: true }, created_at: new Date().toISOString() }));
      await admin.from("admin_audit_log").insert(auditRows);
      return successResponse({ assigned: ticket_ids.length, message: `${ticket_ids.length} ticket(s) assigned` });
    }

    // GET /admin/support/tickets/export — CSV (row 151)
    if (ticketId === "export" && !action && req.method === "GET") {
      const status = url.searchParams.get("status");
      const category = url.searchParams.get("category");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin.from("support_tickets").select("id, ticket_number, subject, category, status, priority, user_id, assigned_to, created_at, updated_at, profiles!user_id(name, email)").order("created_at", { ascending: false }).limit(50000);
      if (status) q = q.eq("status", status);
      if (category) q = q.eq("category", category);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export tickets", 500);
      type Row = { id: string; ticket_number: string; subject: string; category: string; status: string; priority: string | null; user_id: string; assigned_to: string | null; created_at: string; updated_at: string; profiles: { name: string; email: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "ticket_id", value: (r) => r.id },
        { header: "ticket_number", value: (r) => r.ticket_number },
        { header: "subject", value: (r) => r.subject },
        { header: "category", value: (r) => r.category },
        { header: "status", value: (r) => r.status },
        { header: "priority", value: (r) => r.priority },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "assigned_to", value: (r) => r.assigned_to },
        { header: "created_at", value: (r) => r.created_at },
        { header: "updated_at", value: (r) => r.updated_at },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "support_tickets_exported", target_type: "support_tickets", details: { count: rows.length, filters: { status, category, from, to } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `support-tickets-${todayStamp()}.csv`);
    }

    // GET /admin/support/stats
    if (isStats && req.method === "GET") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [open, inProgress, resolved, closed, recent] = await Promise.all([
        admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "resolved"),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "closed"),
        admin.from("support_tickets").select("category, status, created_at, updated_at").gte("updated_at", since),
      ]);
      const rows = (recent.data ?? []) as Array<{ category: string; status: string; created_at: string; updated_at: string }>;
      const byCategory: Record<string, number> = {};
      for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      const resolvedRows = rows.filter((r) => r.status === "resolved" || r.status === "closed");
      const totalMs = resolvedRows.reduce((a, r) => a + (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()), 0);
      const avgResolutionSeconds = resolvedRows.length ? Math.round(totalMs / 1000 / resolvedRows.length) : 0;
      return successResponse({
        open: open.count ?? 0,
        in_progress: inProgress.count ?? 0,
        resolved: resolved.count ?? 0,
        closed: closed.count ?? 0,
        avg_resolution_seconds: avgResolutionSeconds,
        by_category_30d: byCategory,
      });
    }

    // GET /admin/support/tickets
    if (!isStats && !ticketId && req.method === "GET") {
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
