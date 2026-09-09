import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Mongoose pulls in optional native deps it does not need in a Next.js server
  // runtime; keep it external so the bundler does not try to trace them.
  serverExternalPackages: ["mongoose", "bcryptjs"],
  /**
   * The dev server compiles routes on demand and disposes them again after a
   * short idle period, keeping only a handful in memory. This project has ~40
   * API routes, so anything that exercises many of them in sequence — the
   * `verify:*` suites, or simply clicking through several modules — evicts
   * routes and can 404 on the recompile.
   *
   * Holding far more routes for far longer costs only dev-server memory.
   * Production ignores this entirely: everything is compiled ahead of time.
   */
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 100,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
