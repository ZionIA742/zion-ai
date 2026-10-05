import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas"],
  env: {
    NEXT_PUBLIC_WHATSAPP_GRAPH_API_VERSION:
      process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
  },
};

export default nextConfig;
