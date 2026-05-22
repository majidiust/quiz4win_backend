/**
 * Standardised HTTP response helpers for Quiz4Win Edge Functions.
 *
 * All responses:
 *  - Set Content-Type: application/json
 *  - Include CORS headers
 *  - Never leak raw PostgreSQL error messages (use `sanitizeError`)
 *
 * Usage:
 *   return successResponse({ user: { id: '...' } });
 *   return errorResponse('email_taken', 409);
 */

import { corsHeaders } from "./cors.ts";

/** Wrap any data in a 200 JSON success response. */
export function successResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

/**
 * Return a JSON error response.
 * @param message - user-safe error code / message string
 * @param status  - HTTP status code (default 400)
 */
export function errorResponse(
  message: string,
  status = 400,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

/**
 * Converts a raw Supabase / PostgreSQL error into a safe user-facing
 * message. Never expose constraint names, table names, or raw SQL.
 */
export function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return "A record with those details already exists";
    }
    if (msg.includes("foreign key") || msg.includes("violates")) {
      return "Invalid reference — related record not found";
    }
    if (msg.includes("not found") || msg.includes("no rows")) {
      return "Record not found";
    }
  }
  return "Internal server error";
}

/** Shorthand for 401 Unauthorized. */
export const unauthorized = () => errorResponse("unauthorized", 401);

/** Shorthand for 403 Forbidden. */
export const forbidden = (msg = "forbidden") => errorResponse(msg, 403);

/** Shorthand for 404 Not Found. */
export const notFound = (msg = "not_found") => errorResponse(msg, 404);

/** Shorthand for 409 Conflict. */
export const conflict = (msg: string) => errorResponse(msg, 409);

/** Shorthand for 422 Unprocessable Entity. */
export const unprocessable = (msg: string) => errorResponse(msg, 422);

/** Shorthand for 429 Too Many Requests. */
export const tooManyRequests = (retryAfter?: number) =>
  errorResponse("rate_limited", 429, retryAfter
    ? { "Retry-After": String(retryAfter) }
    : {});
