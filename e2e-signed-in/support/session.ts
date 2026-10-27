import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { loadLocalStack } from "./stack";
import type { TestUser } from "./users";

export type SessionCookie = { name: string; value: string };

/** The name the app's session cookie gets for this Supabase address (the library derives it). */
export function sessionCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * Signs the user in with their password and returns the session cookie(s) the app would hold.
 *
 * This is how the tests get a signed-in browser WITHOUT any test-only door in the app: the real
 * Supabase library does the sign-in against the throwaway stack and produces the cookies in exactly
 * the format the app reads. The app itself only ever offers Google sign-in.
 */
export async function sessionCookies(user: TestUser): Promise<SessionCookie[]> {
  const stack = loadLocalStack();
  const captured = new Map<string, string>();

  const client = createServerClient(stack.url, stack.publishableKey, {
    cookies: {
      getAll: () => [...captured].map(([name, value]) => ({ name, value })),
      setAll(cookies) {
        for (const { name, value } of cookies) {
          if (value) captured.set(name, value);
          else captured.delete(name); // an empty value means "remove this cookie"
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error("The test user could not sign in");

  // The library writes its cookies a moment after sign-in resolves.
  for (let attempt = 0; attempt < 50 && captured.size === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (captured.size === 0) throw new Error("Signing in produced no session cookie");
  return [...captured].map(([name, value]) => ({ name, value }));
}

/** Puts the cookies into a browser context, making every page in it signed in as that user. */
export async function addCookies(
  context: BrowserContext,
  baseURL: string,
  cookies: SessionCookie[],
): Promise<void> {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

/** Signs a browser context in as the user and returns the cookies, in case a test wants them again. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  user: TestUser,
): Promise<SessionCookie[]> {
  const cookies = await sessionCookies(user);
  await addCookies(context, baseURL, cookies);
  return cookies;
}

/**
 * The same session cookie with the access token's signature damaged. A real attacker could do this
 * to a stolen or hand-edited cookie; the app must refuse it, not trust what the cookie says.
 */
export function withDamagedSignature(cookies: SessionCookie[]): SessionCookie[] {
  return cookies.map((cookie) => {
    if (!cookie.value.startsWith("base64-")) return cookie;
    const session = JSON.parse(
      Buffer.from(cookie.value.slice("base64-".length), "base64url").toString(),
    );
    session.access_token = `${String(session.access_token).slice(0, -6)}AAAAAA`;
    return {
      name: cookie.name,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    };
  });
}
