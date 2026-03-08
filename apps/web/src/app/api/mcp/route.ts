import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticateApiKey } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Authenticate via API key (Bearer token from OAuth flow or direct)
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    const url = new URL(req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // Create fresh MCP server + transport per request (stateless)
  const server = createMcpServer(auth.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // Let the transport handle the request and return a Response
  return transport.handleRequest(req);
}

export async function GET() {
  return new Response(null, { status: 405 });
}

export async function DELETE() {
  return new Response(null, { status: 405 });
}
