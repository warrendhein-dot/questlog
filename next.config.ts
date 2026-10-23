import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Baseline Content Security Policy. It tells the browser which origins may load what, so an
// injected <script> from elsewhere cannot run or phone home.
// TODO(phase 1): replace 'unsafe-inline' with per-request nonces via proxy.ts (needs dynamic
// rendering, which arrives with auth). Tracked in docs/THREAT-MODEL.md.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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
  cacheComponents: true,
  partialPrefetching: true,
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
