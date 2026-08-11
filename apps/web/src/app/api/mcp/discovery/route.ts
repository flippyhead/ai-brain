import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";
import { getMcpIssuer } from "@/lib/mcp/environment";
import { resolveEnabledMcpToolNames } from "@/lib/mcp/tool-policy";

const CORS_HEADERS = createCorsHeaders("GET, OPTIONS");

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return createCorsOptionsResponse(CORS_HEADERS);
}

export async function GET() {
  const baseUrl = getMcpIssuer();

  return Response.json(
    {
      type: "mcp/server",
      name: "open-brain",
      description:
        "Personal knowledge and temporal memory layer for AI assistants. Automatically store durable context and preserve changed facts as linked history.",
      endpoint: `${baseUrl}/api/mcp`,
      capabilities: ["tools"],
      // Advertise only what this deployment's profile actually registers.
      tools: resolveEnabledMcpToolNames(),
      authentication: {
        type: "oauth2",
        metadata_url: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
    },
    { headers: CORS_HEADERS },
  );
}
