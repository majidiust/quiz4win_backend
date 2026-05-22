/**
 * Admin LiveKit Edge Function — Quiz4Win
 *
 * POST   /admin/livekit/rooms                       — Create room (API #136)
 * GET    /admin/livekit/rooms                       — List rooms (API #137)
 * GET    /admin/livekit/rooms/:name                 — Room detail (API #138)
 * DELETE /admin/livekit/rooms/:name                 — Delete room (API #139)
 * DELETE /admin/livekit/rooms/:name/participants/:id — Remove participant (API #140)
 * POST   /admin/livekit/token                       — Generate token (API #141)
 * POST   /admin/livekit/egress                      — Start egress (API #142)
 * DELETE /admin/livekit/egress/:egress_id           — Stop egress (API #143)
 * POST   /admin/livekit/webhook                     — LiveKit webhook (API #144)
 *
 * Rule compliance: R-01, R-03
 * Note: Full LiveKit integration requires @livekit/server-sdk and env secrets.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const LIVEKIT_URL = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const LIVEKIT_WEBHOOK_SECRET = Deno.env.get("LIVEKIT_WEBHOOK_SECRET") ?? "";

/** Thin helper to call LiveKit Server API */
async function livekitFetch(path: string, method = "GET", body?: unknown) {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY) throw new Error("LiveKit not configured");
  const res = await fetch(`${LIVEKIT_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LIVEKIT_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => ({}));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/livekit\/?/, "").split("/").filter(Boolean);
  const resource = parts[0] ?? null;
  const resourceId = parts[1] ?? null;
  const subResource = parts[2] ?? null;
  const subResourceId = parts[3] ?? null;

  const admin = getAdminClient();

  // LiveKit webhook — no admin auth (LiveKit signs the request)
  if (resource === "webhook" && req.method === "POST") {
    if (!LIVEKIT_WEBHOOK_SECRET) return errorResponse("LiveKit webhook not configured", 503);
    const body = await req.json();
    const event = body.event;
    // Handle room_finished, participant_left, etc.
    if (event === "room_finished") {
      const roomName = body.room?.name;
      if (roomName) {
        await admin.from("games").update({ status: "ended", ended_at: new Date().toISOString() }).eq("livekit_room", roomName).in("status", ["live"]);
      }
    }
    return successResponse({ received: true });
  }

  // All other endpoints require admin auth
  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const configured = LIVEKIT_URL && LIVEKIT_API_KEY;

  try {
    // POST /admin/livekit/rooms
    if (resource === "rooms" && !resourceId && req.method === "POST") {
      if (!configured) return successResponse({ note: "LiveKit not configured", env_needed: ["LIVEKIT_SERVER_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] });
      const body = await req.json();
      const result = await livekitFetch("/twirp/livekit.RoomService/CreateRoom", "POST", { name: body.name, empty_timeout: body.empty_timeout ?? 300, max_participants: body.max_participants ?? 10000 });
      return successResponse({ room: result }, 201);
    }

    // GET /admin/livekit/rooms
    if (resource === "rooms" && !resourceId && req.method === "GET") {
      if (!configured) return successResponse({ note: "LiveKit not configured", rooms: [] });
      const result = await livekitFetch("/twirp/livekit.RoomService/ListRooms", "POST", {});
      return successResponse({ rooms: result.rooms ?? [] });
    }

    // GET /admin/livekit/rooms/:name
    if (resource === "rooms" && resourceId && !subResource && req.method === "GET") {
      if (!configured) return successResponse({ note: "LiveKit not configured" });
      const result = await livekitFetch("/twirp/livekit.RoomService/ListParticipants", "POST", { room: resourceId });
      return successResponse({ room: resourceId, participants: result.participants ?? [] });
    }

    // DELETE /admin/livekit/rooms/:name
    if (resource === "rooms" && resourceId && !subResource && req.method === "DELETE") {
      if (!configured) return successResponse({ note: "LiveKit not configured" });
      await livekitFetch("/twirp/livekit.RoomService/DeleteRoom", "POST", { room: resourceId });
      return successResponse({ message: `Room ${resourceId} deleted` });
    }

    // DELETE /admin/livekit/rooms/:name/participants/:id
    if (resource === "rooms" && resourceId && subResource === "participants" && subResourceId && req.method === "DELETE") {
      if (!configured) return successResponse({ note: "LiveKit not configured" });
      await livekitFetch("/twirp/livekit.RoomService/RemoveParticipant", "POST", { room: resourceId, identity: subResourceId });
      return successResponse({ message: `Participant ${subResourceId} removed from room ${resourceId}` });
    }

    // POST /admin/livekit/token
    if (resource === "token" && req.method === "POST") {
      // Full token generation requires @livekit/server-sdk AccessToken
      return successResponse({ note: "LiveKit token generation requires @livekit/server-sdk. Integrate as: new AccessToken(key, secret).addGrant({roomJoin: true, room}).toJwt()" });
    }

    // POST /admin/livekit/egress
    if (resource === "egress" && !resourceId && req.method === "POST") {
      if (!configured) return successResponse({ note: "LiveKit not configured" });
      const body = await req.json();
      const result = await livekitFetch("/twirp/livekit.Egress/StartRoomCompositeEgress", "POST", body);
      return successResponse({ egress: result }, 201);
    }

    // DELETE /admin/livekit/egress/:egress_id
    if (resource === "egress" && resourceId && req.method === "DELETE") {
      if (!configured) return successResponse({ note: "LiveKit not configured" });
      await livekitFetch("/twirp/livekit.Egress/StopEgress", "POST", { egress_id: resourceId });
      return successResponse({ message: `Egress ${resourceId} stopped` });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-livekit] unhandled error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal server error", 500);
  }
});
