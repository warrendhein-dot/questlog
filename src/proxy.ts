import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/paths";
import { getSupabaseEnv } from "@/lib/env";
import { buildCsp, generateNonce } from "@/lib/security/csp";

/**
 * Runs before every page request (Next.js 16 calls this file `proxy`; it used to be `middleware`).
 *
 * 1. Issues a fresh nonce and the Content-Security-Policy that goes with it.
 * 2. Refreshes the Supabase session cookie, so a signed-in user stays signed in.
 * 3. Sends signed-out visitors to /login, except on the few public paths.
 *
 * Step 3 is the first line of defence, not the only one: protected pages and data also check the
 * user themselves (see `requireUser`), and the database enforces row-level security regardless.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseOrigin: new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin,
  });

  // Next.js reads the nonce from the request's CSP header while rendering the page.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() asks Supabase to validate the session. Never trust the cookie's contents alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const redirect = NextResponse.redirect(loginUrl);
    // Keep any cookie changes Supabase made (for example clearing an expired session).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except build assets, which are public files with nothing to protect.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
