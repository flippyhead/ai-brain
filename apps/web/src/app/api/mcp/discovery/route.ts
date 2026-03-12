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
    tools: [
      "search_thoughts",
      "browse_recent",
      "get_stats",
      "capture_thought",
      "create_report",
      "get_insights",
    ],
    authentication: {
      type: "oauth2",
      metadata_url: `${baseUrl}/.well-known/oauth-authorization-server`,
    },
  });
}
