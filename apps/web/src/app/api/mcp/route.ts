import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { authenticateApiKey } from "@/lib/mcp/auth";
import { createConvexMcpToken } from "@/lib/mcp/convex-auth";
import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";
import { getMcpIssuer } from "@/lib/mcp/environment";
import { createMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = createCorsHeaders(
  "POST, OPTIONS",
  {
    exposeHeaders: "WWW-Authenticate, Allow",
  },
);

export async function OPTIONS() {
  return createCorsOptionsResponse(CORS_HEADERS);
}

export async function POST(req: Request) {
  // Authenticate via API key (Bearer token from OAuth flow or direct)
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    const baseUrl = getMcpIssuer();
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="open-brain"`,
      },
    });
  }

  // Bind the validated API key to a short-lived Convex identity. Convex
  // functions derive ownership from this token, never from caller input.
  const convexAuthToken = await createConvexMcpToken(auth);
  const server = createMcpServer(convexAuthToken);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // Let the transport handle the request, then add CORS headers
  const response = await transport.handleRequest(req);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    },
  );
}

export async function DELETE() {
  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      Allow: "POST, OPTIONS",
    },
  });
}
