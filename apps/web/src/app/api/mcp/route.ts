import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticateApiKey } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  // Authenticate via API key (Bearer token from OAuth flow or direct)
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    const url = new URL(req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
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
  return new Response(
    JSON.stringify({
      error: "Method Not Allowed",
      message: "This is an MCP endpoint. Use POST with a valid MCP client.",
    }),
    {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    }
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ error: "Method Not Allowed" }),
    {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    }
  );
}
