import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snowflake-sdk uses native Node.js modules — keep it server-side only
  serverExternalPackages: ["snowflake-sdk"],
};

export default nextConfig;
