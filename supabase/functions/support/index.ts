/**
 * Support Edge Function — Quiz4Win
 *
 * POST /support/tickets              — Submit support ticket (API #45)
 * GET  /support/tickets              — List my tickets (API #46)
 * GET  /support/articles             — List help articles (API #47) — public
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/support\/?/, "");

  try {
    // GET /support/articles — public, no auth required
    if (path === "articles" && req.method === "GET") {
      const category = url.searchParams.get("category");
      const q = url.searchParams.get("q");

      const admin = getAdminClient();
      let query = admin
        .from("help_articles")
        .select("id, title, category, excerpt, content, updated_at")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });

      if (category) query = query.eq("category", category);
      if (q) query = query.ilike("title", `%${q}%`);

      const { data, error } = await query;
      if (error) return errorResponse("Failed to fetch articles", 500);
      return successResponse({ articles: data ?? [] });
    }

    // Auth required for ticket endpoints
    const { user, error: authErr } = await validateJWT(req);
    if (authErr || !user) return errorResponse("unauthorized", 401);

    const supabase = getAnonClient(req);

    // POST /support/tickets
    if (path === "tickets" && req.method === "POST") {
      const { subject, category, message, priority = "normal" } = await req.json();
      if (!subject || !message) return errorResponse("subject and message are required", 400);

      const validCategories = ["payment", "game", "account", "kyc", "technical", "other"];
      const validPriorities = ["low", "normal", "high", "urgent"];

      if (category && !validCategories.includes(category)) {
        return errorResponse(`Invalid category. Valid: ${validCategories.join(", ")}`, 400);
      }
      if (!validPriorities.includes(priority)) {
        return errorResponse(`Invalid priority. Valid: ${validPriorities.join(", ")}`, 400);
      }

      const admin = getAdminClient();

      // Generate ticket number
      const ticketNumber = `TKT-${Date.now()}-${user.id.substring(0, 6).toUpperCase()}`;

      const { data: ticket, error: ticketErr } = await admin
        .from("support_tickets")
        .insert({
          user_id: user.id,
          ticket_number: ticketNumber,
          subject,
          category: category ?? "other",
          priority,
          status: "open",
          created_at: new Date().toISOString(),
        })
        .select("id, ticket_number, subject, category, status, priority, created_at")
        .single();

      if (ticketErr) return errorResponse(sanitizeError(ticketErr), 500);

      // Add initial message
      await admin.from("support_ticket_messages").insert({
        ticket_id: ticket.id,
        sender_type: "user",
        sender_id: user.id,
        message,
        created_at: new Date().toISOString(),
      });

      return successResponse({ ticket }, 201);
    }

    // GET /support/tickets — list user's tickets
    if (path === "tickets" && req.method === "GET") {
      const statusFilter = url.searchParams.get("status");
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;

      let query = supabase
        .from("support_tickets")
        .select("id, ticket_number, subject, category, status, priority, created_at, updated_at", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (statusFilter) {
        const statuses = statusFilter.split("|");
        if (statuses.length === 1) query = query.eq("status", statuses[0]);
        else query = query.in("status", statuses);
      }

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch tickets", 500);

      return successResponse({
        tickets: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[support] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
