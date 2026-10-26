import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for Client Components. It only ever holds the publishable key, so everything
 * it can do is limited by row-level security. The secret key must never be used here.
 */
export function createSupabaseBrowserClient() {
  const env = getSupabaseEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
