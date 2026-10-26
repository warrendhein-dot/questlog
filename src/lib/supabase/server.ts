import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for server code (Server Components, Server Actions, Route Handlers).
 * It acts as the signed-in user: the session lives in cookies and every query is subject to
 * row-level security. Create a new client per request; never share one between requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getSupabaseEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. That is fine: proxy.ts refreshes the session
            // on every request (added with sign-in).
          }
        },
      },
    },
  );
}
