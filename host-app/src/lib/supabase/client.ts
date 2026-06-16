"use client";

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Browser-side Supabase client. Singleton to avoid duplicate listeners. */
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function createSupabaseBrowserClient() {
  if (!_client) _client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}
