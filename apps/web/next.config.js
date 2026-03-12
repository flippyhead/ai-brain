/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/oauth-metadata",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/oauth-protected-resource",
      },
      {
        source: "/.well-known/mcp.json",
        destination: "/api/mcp/discovery",
      },
    ];
  },
};

export default nextConfig;
