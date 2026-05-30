/**
 * RabbitMQ HTTP publisher for Quiz4Win Edge Functions.
 *
 * We publish via the RabbitMQ Management HTTP API rather than AMQP because:
 *   * Edge Functions run on Deno and there is no first-class AMQP client.
 *   * The HTTP API works over standard fetch and inherits its retries.
 *   * Commands are infrequent (one per AI-enabled game start) so latency
 *     of the management plane is acceptable.
 *
 * Env vars (read at call time, never logged — R-01):
 *   RABBITMQ_URL    — AMQP connection URI, credentials embedded.
 *                     e.g. amqps://user:pass@host/vhost
 *                     The amqp(s) scheme is rewritten to http(s) and the
 *                     AMQP port is stripped — the management API lives on
 *                     the standard 443/80 of the same host (CloudAMQP,
 *                     RabbitMQ.com, and self-hosted with reverse-proxy
 *                     all follow this convention).
 *                     Management URLs (http(s)://…) are also accepted as-is.
 *   RABBITMQ_VHOST  — Optional override; if absent, the vhost is taken from
 *                     the URL path. Defaults to "/" when neither is set.
 */

interface ParsedConfig {
  url: string;
  user: string;
  pass: string;
  vhost: string;
}

/**
 * Parse a single connection URI into the four fields the management API
 * publisher needs. Supports amqp:// amqps:// http:// https:// schemes.
 * Returns null if the URI is empty or malformed.
 */
export function parseRabbitUrl(raw: string): ParsedConfig | null {
  if (!raw) return null;
  let mgmtScheme: "http" | "https";
  let normalised: string;
  if (raw.startsWith("amqps://")) {
    mgmtScheme = "https";
    normalised = "https://" + raw.slice("amqps://".length);
  } else if (raw.startsWith("amqp://")) {
    mgmtScheme = "http";
    normalised = "http://" + raw.slice("amqp://".length);
  } else if (raw.startsWith("https://")) {
    mgmtScheme = "https";
    normalised = raw;
  } else if (raw.startsWith("http://")) {
    mgmtScheme = "http";
    normalised = raw;
  } else {
    return null;
  }
  let u: URL;
  try { u = new URL(normalised); } catch { return null; }
  // Strip the AMQP port (5671/5672) — management plane lives on the default
  // HTTP(S) port of the same host. For http(s):// inputs, preserve the
  // original port if the user explicitly set one (e.g. self-hosted 15672).
  const isAmqp = raw.startsWith("amqp");
  const hostPart = isAmqp ? u.hostname : u.host;
  const vhostPath = u.pathname && u.pathname !== "/" ? decodeURIComponent(u.pathname.slice(1)) : "/";
  return {
    url: `${mgmtScheme}://${hostPart}`,
    user: decodeURIComponent(u.username),
    pass: decodeURIComponent(u.password),
    vhost: vhostPath,
  };
}

export interface PublishOptions {
  /** Target exchange name. Use empty string to publish to the default exchange. */
  exchange: string;
  /** Routing key — for default exchange this is the queue name. */
  routingKey: string;
  /** Message body (will be JSON.stringify'd). */
  payload: unknown;
  /** Optional AMQP headers (correlation_id, content_type, etc.). */
  properties?: Record<string, unknown>;
}

export interface PublishResult {
  ok: boolean;
  routed?: boolean;
  status?: number;
  error?: string;
}

function getEnv(): ParsedConfig {
  const raw = Deno.env.get("RABBITMQ_URL") ?? "";
  const vhostOverride = Deno.env.get("RABBITMQ_VHOST");
  const parsed = parseRabbitUrl(raw);
  if (!parsed) {
    return { url: "", user: "", pass: "", vhost: vhostOverride && vhostOverride.length > 0 ? vhostOverride : "/" };
  }
  return {
    ...parsed,
    vhost: vhostOverride && vhostOverride.length > 0 ? vhostOverride : parsed.vhost,
  };
}

export function isConfigured(): boolean {
  const env = getEnv();
  return !!(env.url && env.user && env.pass);
}

/**
 * Publish a JSON message to the configured RabbitMQ broker.
 *
 * Best-effort: never throws — callers receive `{ ok: false, error }` and
 * decide whether to retry. AI presenter publishing must never block a game
 * lifecycle change (R-D-AI invariant: presenter is decorative).
 */
export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const env = getEnv();
  if (!env.url || !env.user || !env.pass) {
    return { ok: false, error: "rabbitmq_not_configured" };
  }

  const vhostEnc = encodeURIComponent(env.vhost);
  const exchangeEnc = encodeURIComponent(opts.exchange);
  const endpoint = `${env.url.replace(/\/$/, "")}/api/exchanges/${vhostEnc}/${exchangeEnc}/publish`;

  const body = {
    properties: {
      content_type: "application/json",
      delivery_mode: 2, // persistent
      ...(opts.properties ?? {}),
    },
    routing_key: opts.routingKey,
    payload: JSON.stringify(opts.payload),
    payload_encoding: "string",
  };

  const auth = "Basic " + btoa(`${env.user}:${env.pass}`);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    const data = await res.json().catch(() => ({})) as { routed?: boolean };
    return { ok: true, routed: !!data.routed, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Compose and publish the `quiz.show.start` command used by the AI presenter
 * service to join a LiveKit room and host the show for a generated game.
 *
 * Fields mirror the `lottery.show.start` schema in
 * docs/live-avatar-and-game-template-engine.md but adapted to Quiz4Win
 * (no draw numbers — the presenter announces questions/results instead).
 */
export async function publishQuizShowStart(input: {
  gameId: string;
  templateId: string | null;
  title: string;
  language: string;
  avatarId: string | null;
  voiceId: string | null;
  durationSeconds: number | null;
  livekitUrl?: string;
  livekitRoomName: string | null;
  totalPrize: number;
  currency: string;
}): Promise<PublishResult> {
  const exchange = Deno.env.get("MQ_COMMAND_EXCHANGE") ?? "";
  const routingKey = Deno.env.get("MQ_COMMAND_QUEUE") ?? "quiz.show.start";
  const jobId = `quiz-${input.gameId}-${Date.now()}`;

  return await publish({
    exchange,
    routingKey,
    payload: {
      jobId,
      correlationId: crypto.randomUUID(),
      gameId: `QUIZ:${input.gameId}`,
      templateId: input.templateId,
      tournamentName: input.title,
      language: input.language,
      durationSeconds: input.durationSeconds,
      avatarId: input.avatarId,
      voiceId: input.voiceId,
      totalPrize: input.totalPrize,
      currency: input.currency,
      liveKit: {
        url: input.livekitUrl ?? Deno.env.get("LIVEKIT_SERVER_URL") ?? "",
        roomName: input.livekitRoomName,
      },
    },
    properties: { message_id: jobId },
  });
}
