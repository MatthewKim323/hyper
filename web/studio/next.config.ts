import type { NextConfig } from "next";

const onboardingBackend = (process.env.ONBOARDING_BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The engine boots once and owns the DOM imperatively; strict-mode double mount would double-boot it.
  reactStrictMode: false,
  devIndicators: false,
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  rewrites() {
    return [
      {
        source: "/api/onboarding/:path*",
        destination: `${onboardingBackend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
