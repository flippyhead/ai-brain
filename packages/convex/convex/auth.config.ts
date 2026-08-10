import type { AuthConfig } from "convex/server";

const mcpJwtIssuer = process.env.MCP_JWT_ISSUER;

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
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
