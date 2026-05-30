/**
 * Unit tests for _shared/rabbitmq.ts
 *
 * Run:
 *   deno test supabase/functions/_shared/rabbitmq_test.ts \
 *     --allow-env --no-check
 *
 * Tests use manual fetch mocking via globalThis.fetch override so that no
 * real network connections are made.  Each test restores the original fetch
 * after it finishes.
 */

import { assertEquals } from "jsr:@std/assert";
import { isConfigured, parseRabbitUrl, publish, publishQuizShowStart } from "./rabbitmq.ts";

const AMQPS = "amqps://u:p@rabbit.example.com/vh";
const HTTP_MGMT = "http://u:p@rabbit:15672";

// ---------------------------------------------------------------------------
// Helper: temporarily replace Deno.env.get and globalThis.fetch
// ---------------------------------------------------------------------------

type EnvMap = Record<string, string | undefined>;

function withEnv(vars: EnvMap, fn: () => unknown | Promise<unknown>): Promise<void> {
  const original = Deno.env.get.bind(Deno.env);
  // @ts-ignore – override for testing
  Deno.env.get = (key: string): string | undefined => {
    if (key in vars) return vars[key];
    return original(key);
  };
  const result = Promise.resolve().then(() => fn());
  return result.finally(() => {
    // @ts-ignore – restore
    Deno.env.get = original;
  });
}

interface MockResponse {
  ok: boolean;
  status?: number;
  body?: unknown;
  throws?: boolean;
}

function mockFetch(spec: MockResponse): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (spec.throws) throw new Error("network_failure");
    const status = spec.status ?? (spec.ok ? 200 : 500);
    const bodyText = JSON.stringify(spec.body ?? {});
    return new Response(bodyText, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => { globalThis.fetch = original; };
}

// ---------------------------------------------------------------------------
// parseRabbitUrl()
// ---------------------------------------------------------------------------

Deno.test("parseRabbitUrl → returns null for empty", () => {
  assertEquals(parseRabbitUrl(""), null);
});

Deno.test("parseRabbitUrl → returns null for unsupported scheme", () => {
  assertEquals(parseRabbitUrl("redis://x"), null);
});

Deno.test("parseRabbitUrl → amqps:// strips port and extracts vhost", () => {
  const r = parseRabbitUrl("amqps://laqjggue:secretpw@dragonfly.rmq4.cloudamqp.com:5671/laqjggue");
  assertEquals(r, {
    url: "https://dragonfly.rmq4.cloudamqp.com",
    user: "laqjggue",
    pass: "secretpw",
    vhost: "laqjggue",
  });
});

Deno.test("parseRabbitUrl → amqp:// maps to http://", () => {
  const r = parseRabbitUrl("amqp://u:p@rabbit/");
  assertEquals(r?.url, "http://rabbit");
  assertEquals(r?.vhost, "/");
});

Deno.test("parseRabbitUrl → http:// management URL preserves port", () => {
  const r = parseRabbitUrl("http://u:p@rabbit:15672/");
  assertEquals(r?.url, "http://rabbit:15672");
});

Deno.test("parseRabbitUrl → percent-encoded credentials are decoded", () => {
  const r = parseRabbitUrl("amqps://u%40v:p%2Fass@host/vh");
  assertEquals(r?.user, "u@v");
  assertEquals(r?.pass, "p/ass");
});

// ---------------------------------------------------------------------------
// isConfigured()
// ---------------------------------------------------------------------------

Deno.test("isConfigured → false when RABBITMQ_URL unset", () =>
  withEnv({ RABBITMQ_URL: "" }, () => {
    assertEquals(isConfigured(), false);
  }),
);

Deno.test("isConfigured → false when URL has no credentials", () =>
  withEnv({ RABBITMQ_URL: "amqps://rabbit.example.com/vh" }, () => {
    assertEquals(isConfigured(), false);
  }),
);

Deno.test("isConfigured → true for valid amqps:// URL", () =>
  withEnv({ RABBITMQ_URL: AMQPS }, () => {
    assertEquals(isConfigured(), true);
  }),
);

// ---------------------------------------------------------------------------
// publish()
// ---------------------------------------------------------------------------

Deno.test("publish → returns error when not configured", () =>
  withEnv({ RABBITMQ_URL: "" }, async () => {
    const res = await publish({ exchange: "", routingKey: "q", payload: { test: 1 } });
    assertEquals(res.ok, false);
    assertEquals(res.error, "rabbitmq_not_configured");
  }),
);

Deno.test("publish → returns ok:true and routed flag on 200", () =>
  withEnv({ RABBITMQ_URL: HTTP_MGMT }, async () => {
    const restore = mockFetch({ ok: true, status: 200, body: { routed: true } });
    try {
      const res = await publish({ exchange: "ex", routingKey: "rk", payload: { x: 1 } });
      assertEquals(res.ok, true);
      assertEquals(res.routed, true);
      assertEquals(res.status, 200);
    } finally { restore(); }
  }),
);

Deno.test("publish → returns ok:false on non-200 response", () =>
  withEnv({ RABBITMQ_URL: HTTP_MGMT }, async () => {
    const restore = mockFetch({ ok: false, status: 401, body: "Unauthorized" });
    try {
      const res = await publish({ exchange: "", routingKey: "rk", payload: {} });
      assertEquals(res.ok, false);
      assertEquals(res.status, 401);
    } finally { restore(); }
  }),
);

Deno.test("publish → returns ok:false on network failure", () =>
  withEnv({ RABBITMQ_URL: HTTP_MGMT }, async () => {
    const restore = mockFetch({ ok: false, throws: true });
    try {
      const res = await publish({ exchange: "", routingKey: "rk", payload: {} });
      assertEquals(res.ok, false);
      assertEquals(res.error, "network_failure");
    } finally { restore(); }
  }),
);

Deno.test("publish → builds endpoint with vhost from URL", () =>
  withEnv({ RABBITMQ_URL: "amqps://u:p@host/myvhost" }, async () => {
    let capturedUrl = "";
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ routed: true }), { status: 200 });
    };
    try {
      await publish({ exchange: "", routingKey: "rk", payload: {} });
      assertEquals(capturedUrl, "https://host/api/exchanges/myvhost//publish");
    } finally { globalThis.fetch = original; }
  }),
);

Deno.test("publish → RABBITMQ_VHOST env overrides URL path", () =>
  withEnv({ RABBITMQ_URL: "amqps://u:p@host/url-vhost", RABBITMQ_VHOST: "override" }, async () => {
    let capturedUrl = "";
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ routed: true }), { status: 200 });
    };
    try {
      await publish({ exchange: "", routingKey: "rk", payload: {} });
      assertEquals(capturedUrl, "https://host/api/exchanges/override//publish");
    } finally { globalThis.fetch = original; }
  }),
);

// ---------------------------------------------------------------------------
// publishQuizShowStart()
// ---------------------------------------------------------------------------

Deno.test("publishQuizShowStart → builds correct payload and delegates to publish", () =>
  withEnv(
    {
      RABBITMQ_URL: HTTP_MGMT,
      MQ_COMMAND_EXCHANGE: "quiz.commands",
      MQ_COMMAND_QUEUE: "quiz.show.start",
      LIVEKIT_SERVER_URL: "wss://lk.example.com",
    },
    async () => {
      let capturedBody: unknown = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ routed: true }), { status: 200 });
      };
      try {
        const res = await publishQuizShowStart({
          gameId: "game-123",
          templateId: "tmpl-456",
          title: "Sunday Trivia",
          language: "en",
          avatarId: "avatar-abc",
          voiceId: "voice-xyz",
          durationSeconds: 300,
          livekitRoomName: "room-game-123",
          totalPrize: 10000,
          currency: "USD",
        });
        assertEquals(res.ok, true);
        // Verify the payload structure
        const body = capturedBody as { routing_key: string; payload: string };
        assertEquals(body.routing_key, "quiz.show.start");
        const payload = JSON.parse(body.payload) as { gameId: string; language: string };
        assertEquals(payload.gameId, "QUIZ:game-123");
        assertEquals(payload.language, "en");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ),
);
