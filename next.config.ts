import type { NextConfig } from "next";

// The Content-Security-Policy is NOT set here: it contains a fresh nonce per request, so it is
// built in src/proxy.ts (see src/lib/security/csp.ts). These headers never change, so a static
// list is fine.
const securityHeaders = [
  // Force HTTPS for two years (ignored by browsers over plain http, e.g. localhost).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Stop browsers guessing a file's type (blocks some content-sniffing attacks).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy clickjacking defence for browsers that ignore CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak full URLs to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Switch off powerful browser features we never use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Isolate our window from cross-origin pop-ups.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // `cacheComponents` (partial prerendering) and `partialPrefetching` were switched on by the
  // starter template but are removed on purpose: the Next.js docs state that PPR is incompatible
  // with nonce-based CSP, and a signed-in, single-user app gains nothing from static prerendering.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Don't advertise the framework in an "X-Powered-By" header.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
