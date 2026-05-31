/**
 * LiveKit broadcaster for Quiz4Win Real-Time Quiz.
 *
 * Two capabilities:
 *   1. signAccessToken()   — produce a signed LiveKit JWT for a client to join.
 *   2. sendRoomData()      — publish a DataChannel message to all participants
 *                            in a room via the LiveKit server REST API.
 *
 * Implementation uses Web Crypto (HMAC-SHA256) so no external SDK is needed.
 *
 * Env vars (never logged — R-01):
 *   LIVEKIT_SERVER_URL  — wss://…livekit.cloud  (or http://… for local)
 *   LIVEKIT_API_KEY     — API key ID
 *   LIVEKIT_API_SECRET  — API key secret (signing key)
 */

// ─── Base64URL helpers ───────────────────────────────────────────────────────

function base64url(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlStr(str: string): string {
  return base64url(new TextEncoder().encode(str).buffer);
}

// ─── JWT signing (HS256) ──────────────────────────────────────────────────────

async function signHS256(header: object, payload: object, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = `${base64urlStr(JSON.stringify(header))}.${base64urlStr(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return `${input}.${base64url(sig)}`;
}

// ─── Access token ─────────────────────────────────────────────────────────────

export interface LiveKitGrants {
  roomJoin?: boolean;
  room?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

/**
 * Sign a LiveKit access token for a client to join a room.
 * TTL defaults to 4 hours (game sessions should be shorter).
 */
export async function signAccessToken(
  identity: string,
  roomName: string,
  grants: LiveKitGrants = {},
  ttlSeconds = 14_400,
): Promise<string> {
  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    exp: now + ttlSeconds,
    nbf: now,
    video: {
      roomJoin: grants.roomJoin ?? true,
      room: grants.room ?? roomName,
      canPublish: grants.canPublish ?? false,
      canSubscribe: grants.canSubscribe ?? true,
      canPublishData: grants.canPublishData ?? false,
    },
  };
  return signHS256(header, payload, apiSecret);
}

// ─── Room data broadcast ──────────────────────────────────────────────────────

export interface SendDataOptions {
  /** Destination userIdentities; omit or pass [] to broadcast to all. */
  destinationIdentities?: string[];
  /** Optional topic label visible in the DataChannel message. */
  topic?: string;
}

/**
 * Publish a JSON payload to all (or specific) participants in a LiveKit room
 * via the server REST API (Twirp endpoint).
 *
 * Best-effort: logs errors but never throws so a broadcast failure never
 * aborts game state changes.
 */
export async function sendRoomData(
  roomName: string,
  payload: unknown,
  opts: SendDataOptions = {},
): Promise<void> {
  const serverUrl = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  if (!serverUrl || !apiKey || !apiSecret) {
    console.warn("[livekit] sendRoomData skipped — LIVEKIT_* env vars not set");
    return;
  }

  // Convert wss:// → https:// for the REST endpoint
  const httpBase = serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");

  // Server-side token with roomAdmin grant
  const token = await signHS256(
    { alg: "HS256", typ: "JWT" },
    {
      iss: apiKey,
      sub: "quiz4win-orchestrator",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      video: { roomAdmin: true, room: roomName },
    },
    apiSecret,
  );

  const data = new TextEncoder().encode(JSON.stringify(payload));
  const body: Record<string, unknown> = {
    room: roomName,
    data: btoa(String.fromCharCode(...data)), // base64-encoded binary
    kind: 1, // RELIABLE
  };
  if (opts.destinationIdentities?.length) {
    body.destination_identities = opts.destinationIdentities;
  }
  if (opts.topic) body.topic = opts.topic;

  try {
    const res = await fetch(`${httpBase}/twirp/livekit.RoomService/SendData`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[livekit] sendRoomData HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[livekit] sendRoomData fetch failed:", err instanceof Error ? err.message : err);
  }
}
