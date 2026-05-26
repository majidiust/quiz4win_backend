/**
 * Supabase client factories for Edge Functions.
 *
 * Two clients are provided:
 *
 * 1. `getAnonClient(req)` — Creates a client using the anon key and
 *    forwards the user's Authorization header so all queries run under
 *    that user's RLS context. Use for read operations on behalf of a user.
 *
 * 2. `getAdminClient()` — Creates a client using the service-role key,
 *    which bypasses RLS. Use only for writes that must be authoritative
 *    (e.g., crediting wallet after Stripe webhook — no user JWT available).
 *    ⚠️  Never expose the admin client or service-role key to the caller.
 *
 * Rule compliance:
 *  - R-01: Credentials from env only, never hardcoded.
 *  - R-04: Prefer anon client (respects RLS); admin client is last resort.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Returns a Supabase client that operates in the authenticated user's
 * RLS context. Always prefer this client over the admin client.
 *
 * NOTE: only call this when the request actually carries a valid user
 * JWT. For unauthenticated endpoints (signin/signup/refresh/verify-otp,
 * and any current-password verification step) use `getPublicClient()`
 * instead — forwarding a stale/invalid Bearer into supabase.auth.* makes
 * gotrue reply with the misleading "Invalid API key" error.
 */
export function getAnonClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

/**
 * Returns a Supabase client using only the anon key — no forwarded
 * Authorization header. Use this for any unauthenticated call:
 *   - auth.signInWithPassword / signUp / refreshSession / verifyOtp
 *   - re-verifying a user's current password before a password change
 *
 * Why this exists: `getAnonClient()` forwards the incoming request's
 * `Authorization` header into the Supabase JS client's `global.headers`,
 * which overrides the SDK's default `Bearer <anon_key>` on the call to
 * `/auth/v1/*`. When the caller (typically a mobile client) retries
 * signin while still carrying a revoked/expired user JWT, gotrue rejects
 * the call and returns `Invalid API key` — manifesting as intermittent
 * "sometimes works, sometimes fails" sign-in errors.
 */
export function getPublicClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Returns a Supabase client with the service-role key.
 * Bypasses RLS — use only when no user JWT is available (e.g., webhooks)
 * or for server-authoritative writes (e.g., prize crediting).
 */
export function getAdminClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
