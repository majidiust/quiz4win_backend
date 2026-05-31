/**
 * Redis client singleton for Quiz4Win Edge Functions.
 *
 * Uses npm:redis@4 (official Redis client), which is compatible with Deno
 * via npm specifiers. The client is cached for the isolate lifetime so
 * repeated calls within a single request incur no reconnection overhead.
 *
 * Env vars (never logged — R-01):
 *   REDIS_URL — full connection URL, e.g.
 *               redis://:password@redis:6379   (self-hosted docker-compose)
 *               rediss://:token@…upstash.io:6380 (Upstash TLS)
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:redis@4";

export type RedisClient = ReturnType<typeof createClient>;

let _client: RedisClient | null = null;

/**
 * Return the cached Redis client, creating and connecting it on first call.
 * Never logs the connection URL (R-01).
 */
export async function getRedis(): Promise<RedisClient> {
  if (_client && (_client as any).isReady) return _client;

  const url = Deno.env.get("REDIS_URL") ?? "redis://127.0.0.1:6379";
  _client = createClient({ url });
  (_client as any).on("error", (err: Error) =>
    console.error("[redis] client error:", err.message),
  );
  await (_client as any).connect();
  return _client;
}

/**
 * Run a Lua script atomically.
 *
 * @param client  - connected RedisClient
 * @param script  - Lua source string
 * @param keys    - KEYS[] array (Redis cluster-safe key list)
 * @param args    - ARGV[] array (string arguments)
 * @returns       - whatever the Lua script returns (usually a JSON string)
 */
export async function evalScript(
  client: RedisClient,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  return await (client as any).eval(script, { keys, arguments: args });
}

/**
 * Disconnect and clear the cached client. Call during graceful shutdown only.
 */
export async function closeRedis(): Promise<void> {
  if (_client) {
    try {
      await (_client as any).quit();
    } catch {
      // ignore
    }
    _client = null;
  }
}
