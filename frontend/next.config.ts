import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snowflake-sdk uses native Node.js modules — keep it server-side only
  serverExternalPackages: ["snowflake-sdk"],
  // Produce a self-contained server bundle for Docker / SPCS
  output: "standalone",
};

export default nextConfig;
