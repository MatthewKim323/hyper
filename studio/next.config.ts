import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine boots once and owns the DOM imperatively; strict-mode double mount would double-boot it.
  reactStrictMode: false,
  devIndicators: false,
};

export default nextConfig;
