import "server-only";
import { createSupabaseServerClient } from "./supabase/server";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");

export interface ApiOk<T> { ok: true; status: number; data: T }
export interface ApiErr { ok: false; status: number; error: string }
export type ApiResult<T> = ApiOk<T> | ApiErr;

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/** Server-side fetch against api.quiz4win.com with the user's session token. */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(opts.headers);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const init: RequestInit = {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    cache: "no-store",
  };
  if (opts.body !== undefined) {
    init.body = opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message ?? "network_error" };
  }

  const ct = res.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (ct.includes("application/json")) {
    try { payload = await res.json(); } catch { payload = null; }
  } else {
    try { payload = await res.text(); } catch { payload = null; }
  }

  if (!res.ok) {
    const err = (payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>))
      ? String((payload as { error: unknown }).error) : `http_${res.status}`;
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, status: res.status, data: payload as T };
}

/** Convenience: fetch JSON, throw on error, return data only. */
export async function apiOrThrow<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const r = await api<T>(path, opts);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
