import { MCP_TOOL_NAME_LIST } from "@/lib/mcp/tools";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return Response.json({
    type: "mcp/server",
    name: "open-brain",
    description:
      "Personal knowledge and memory layer for AI assistants. Store and retrieve thoughts, decisions, ideas, and references.",
    endpoint: `${baseUrl}/api/mcp`,
    capabilities: ["tools"],
    tools: MCP_TOOL_NAME_LIST,
    authentication: {
      type: "oauth2",
      metadata_url: `${baseUrl}/.well-known/oauth-authorization-server`,
    },
  }, { headers: CORS_HEADERS });
}
