import type { NextConfig } from "next";

const onboardingBackend = (process.env.ONBOARDING_BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
// Mintlify hosts the docs. Pointing the domain's CNAME at them would send *every* path
// there, taking the product offline, so /docs is reverse-proxied instead.
const docsHost = (process.env.DOCS_HOST ?? "hyper-23543524.mintlify.site").replace(/^https?:\/\//, "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The engine boots once and owns the DOM imperatively; strict-mode double mount would double-boot it.
  reactStrictMode: false,
  // A second dev server (for example one pointed at tools/dev_backend.py) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  // Browser previews/proxies reach the dev server via 127.0.0.1, which is not covered by the localhost default.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  rewrites() {
    return [
      {
        source: "/api/onboarding/:path*",
        destination: `${onboardingBackend}/:path*`,
      },
      { source: "/docs", destination: `https://${docsHost}/docs` },
      { source: "/docs/:path*", destination: `https://${docsHost}/docs/:path*` },
    ];
  },
};

export default nextConfig;
