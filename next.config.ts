import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // fixtures/ are read at runtime only in DATA_SOURCE=fixture mode
  outputFileTracingIncludes: { "/*": ["./fixtures/**/*"] },
};

export default nextConfig;
