import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";

const CORS_HEADERS = createCorsHeaders("GET, OPTIONS");

export async function OPTIONS() {
  return createCorsOptionsResponse(CORS_HEADERS);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return Response.json({
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
  }, { headers: CORS_HEADERS });
}
