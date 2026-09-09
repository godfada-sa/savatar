import type { NextConfig } from "next";

const signalingOrigin = process.env.NEXT_PUBLIC_SIGNALING_URL || "http://localhost:4000";
const signalingWebSocketOrigin = signalingOrigin.replace(/^http/, "ws");
// Firebase signInWithPopup(Google) injects Google's auth scripts into the page;
// without these origins the popup flow fails with a CSP violation.
const googleAuthScripts = "https://apis.google.com https://accounts.google.com";
const scriptPolicy =
  process.env.NODE_ENV === "development"
    ? `'self' 'unsafe-inline' 'unsafe-eval' ${googleAuthScripts}`
    : `'self' 'unsafe-inline' ${googleAuthScripts}`;
const commonContentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptPolicy}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.googleapis.com",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  `connect-src 'self' ${signalingOrigin} ${signalingWebSocketOrigin} https://*.googleapis.com https://apis.google.com https://*.firebaseio.com wss://*.firebaseio.com https://*.fal.ai https://*.fal.run wss://*.fal.run`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["firebase-admin", "jose", "jwks-rsa"],
  async headers() {
    return [
      {
        source: "/:path((?!obs/).*)",
        headers: [
          { key: "Content-Security-Policy", value: `${commonContentSecurityPolicy}; frame-ancestors 'none'` },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=(), usb=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ],
      },
      {
        source: "/obs/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `${commonContentSecurityPolicy}; frame-ancestors 'self'` },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
