import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Uses anon key + cookie storage shared with server. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
