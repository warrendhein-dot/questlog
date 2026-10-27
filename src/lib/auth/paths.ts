/**
 * Pages a signed-out visitor may open. Everything else requires a signed-in user.
 * Keep this list as short as possible: a path added here is reachable by anyone on the internet.
 */
const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}
