import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  output: "standalone",
  transpilePackages: ["recharts"],

  experimental: {
    serverActions: {},
  },

  // @ts-ignore
  typescript: {
    ignoreBuildErrors: true,
  },

  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.conditionNames = ["node", "require", "default"];
    }

    return config;
  },
};

export default nextConfig;
