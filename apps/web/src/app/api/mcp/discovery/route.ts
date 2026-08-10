import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";
import { getMcpIssuer } from "@/lib/mcp/environment";
import { MCP_TOOL_NAME_LIST } from "@/lib/mcp/tools";

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
      tools: MCP_TOOL_NAME_LIST,
      authentication: {
        type: "oauth2",
        metadata_url: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
    },
    { headers: CORS_HEADERS },
  );
}
