/**
 * Unit tests for _shared/livekit.ts signAccessToken.
 *
 * Run from the repo root:
 *   deno test --allow-env supabase/functions/_shared/livekit.test.ts
 *
 * No network access is required — the HMAC signature is recomputed locally
 * with the same secret and compared byte-for-byte against the token output.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Env vars must be set *before* the module under test is imported because
// signAccessToken reads them at call time, but using a stable test secret
// keeps the recomputed signature deterministic across runs.
Deno.env.set("LIVEKIT_API_KEY", "APItestkey");
Deno.env.set("LIVEKIT_API_SECRET", "supersecret-do-not-use-in-prod");

const { signAccessToken } = await import("./livekit.ts");

// ─── Helpers ────────────────────────────────────────────────────────────────

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return atob(b64);
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  const str = b64urlDecodeToString(s);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test("signAccessToken returns a three-segment JWT", async () => {
  const tok = await signAccessToken("user-1", "game-room", { roomJoin: true });
  const parts = tok.split(".");
  assertEquals(parts.length, 3, "JWT must have header.payload.signature");
  for (const p of parts) assertExists(p, "no segment may be empty");
});

Deno.test("header is HS256/JWT", async () => {
  const tok = await signAccessToken("u", "r");
  const header = JSON.parse(b64urlDecodeToString(tok.split(".")[0]));
  assertEquals(header.alg, "HS256");
  assertEquals(header.typ, "JWT");
});

Deno.test("payload contains expected LiveKit claims", async () => {
  const before = Math.floor(Date.now() / 1000);
  const tok = await signAccessToken("user-42", "lobby", {
    roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true,
  }, 3600);
  const after = Math.floor(Date.now() / 1000);

  const payload = JSON.parse(b64urlDecodeToString(tok.split(".")[1]));
  assertEquals(payload.iss, "APItestkey");
  assertEquals(payload.sub, "user-42");
  assertEquals(payload.video.room, "lobby");
  assertEquals(payload.video.roomJoin, true);
  assertEquals(payload.video.canPublish, true);
  assertEquals(payload.video.canSubscribe, true);
  assertEquals(payload.video.canPublishData, true);

  // Timing claims must fall within the test window.
  if (payload.iat < before || payload.iat > after + 1) {
    throw new Error(`iat ${payload.iat} not in [${before}, ${after + 1}]`);
  }
  assertEquals(payload.exp, payload.iat + 3600);
  assertEquals(payload.nbf, payload.iat);
});

Deno.test("signature verifies with the secret", async () => {
  const tok = await signAccessToken("host-x", "game-x", { roomJoin: true, canPublish: true });
  const [h, p, s] = tok.split(".");
  const expected = await hmacSha256("supersecret-do-not-use-in-prod", `${h}.${p}`);
  const provided = b64urlDecodeToBytes(s);
  assertEquals(provided.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (provided[i] !== expected[i]) {
      throw new Error(`signature byte ${i} mismatch: got ${provided[i]}, expected ${expected[i]}`);
    }
  }
});

Deno.test("signature does NOT verify with the wrong secret (defensive)", async () => {
  const tok = await signAccessToken("u", "r");
  const [h, p, s] = tok.split(".");
  const wrong = await hmacSha256("definitely-not-the-secret", `${h}.${p}`);
  const provided = b64urlDecodeToBytes(s);
  let same = provided.length === wrong.length;
  if (same) {
    for (let i = 0; i < wrong.length; i++) {
      if (provided[i] !== wrong[i]) { same = false; break; }
    }
  }
  assertEquals(same, false, "signature must differ when the secret differs");
});

Deno.test("default grants: canPublish false, canSubscribe true", async () => {
  const tok = await signAccessToken("viewer", "lobby");
  const payload = JSON.parse(b64urlDecodeToString(tok.split(".")[1]));
  assertEquals(payload.video.canPublish, false, "default canPublish must be false (viewer)");
  assertEquals(payload.video.canSubscribe, true, "default canSubscribe must be true (viewer)");
  assertEquals(payload.video.canPublishData, false, "default canPublishData must be false");
});
