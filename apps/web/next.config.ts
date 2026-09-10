import type { NextConfig } from "next";

const apiUrl = process.env["PAYMOD_API_URL"] ?? process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
