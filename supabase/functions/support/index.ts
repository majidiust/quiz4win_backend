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

      // Schema: help_articles(id, title, content, category, language,
      // is_published, created_at, updated_at). No excerpt or sort_order columns.
      const admin = getAdminClient();
      const lang = url.searchParams.get("lang");
      let query = admin
        .from("help_articles")
        .select("id, title, category, content, language, updated_at")
        .eq("is_published", true)
        .order("updated_at", { ascending: false });

      if (category) query = query.eq("category", category);
      if (lang) query = query.eq("language", lang);
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
    // Schema: support_tickets(user_id, ticket_number, category in
    //   ('payment','kyc','game','account','other'), subject, description,
    //   status, created_at, updated_at). No `priority` column.
    if (path === "tickets" && req.method === "POST") {
      const { subject, category, message } = await req.json();
      if (!subject || !message) return errorResponse("subject and message are required", 400);

      const validCategories = ["payment", "game", "account", "kyc", "other"];

      if (category && !validCategories.includes(category)) {
        return errorResponse(`Invalid category. Valid: ${validCategories.join(", ")}`, 400);
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
          description: message, // schema column is `description` on the ticket
          category: category ?? "other",
          status: "open",
        })
        .select("id, ticket_number, subject, category, status, created_at")
        .single();

      if (ticketErr) return errorResponse(sanitizeError(ticketErr), 500);

      // Add initial message (column is `content`, not `message`).
      await admin.from("support_ticket_messages").insert({
        ticket_id: ticket.id,
        sender_type: "user",
        sender_id: user.id,
        content: message,
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
        .select("id, ticket_number, subject, category, status, created_at, updated_at", { count: "exact" })
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
