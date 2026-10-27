/**
 * Content Security Policy (CSP) with a fresh nonce per request.
 *
 * A nonce is a random, single-use token. The policy only lets a script run if it carries the
 * matching nonce, so a script injected into the page by an attacker (which cannot know the nonce)
 * is blocked by the browser. This replaces the weaker 'unsafe-inline' rule from Phase 0.
 *
 * Next.js reads the nonce out of the CSP header and stamps it onto its own scripts and styles.
 * That only works for pages rendered per request, which is why the root layout opts in to dynamic
 * rendering and why `cacheComponents` (partial prerendering) is switched off.
 */

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export type CspOptions = {
  nonce: string;
  /** Development needs 'unsafe-eval' for React's debugging tools; production does not. */
  isDev: boolean;
  /** Origin of the Supabase project, e.g. https://abc.supabase.co (browser auth requests go here). */
  supabaseOrigin: string;
};

export function buildCsp({ nonce, isDev, supabaseOrigin }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonce-approved script load the scripts it needs; 'self' is ignored by
    // modern browsers when it is present and remains only as a fallback for old ones.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Development only: Next's error overlay and hot reload apply inline styles. Browsers ignore
    // 'unsafe-inline' when a nonce is present, so in development the nonce is left out of
    // style-src. Production keeps the strict nonce-only rule.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin}${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Upgrading http to https would break plain-http localhost development.
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
