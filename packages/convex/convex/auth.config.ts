import type { AuthConfig } from "convex/server";

const mcpJwtIssuer = process.env.MCP_JWT_ISSUER;
const convexSiteUrl = process.env.CONVEX_SITE_URL;
if (!convexSiteUrl) {
  throw new Error("CONVEX_SITE_URL is not configured");
}

export default {
  providers: [
    {
      domain: convexSiteUrl,
      applicationID: "convex",
    },
    ...(mcpJwtIssuer
      ? [
          {
            type: "customJwt" as const,
            issuer: mcpJwtIssuer,
            applicationID: "ai-brain-convex-mcp",
            jwks: `${mcpJwtIssuer}/.well-known/mcp-jwks.json`,
            algorithm: "ES256" as const,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;
