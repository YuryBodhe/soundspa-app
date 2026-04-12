import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    SESSION_SECRET: process.env.SESSION_SECRET || ''
  }
};

export default nextConfig;