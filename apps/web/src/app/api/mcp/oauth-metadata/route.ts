import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";

const CORS_HEADERS = createCorsHeaders("GET, OPTIONS");

export async function OPTIONS() {
  return createCorsOptionsResponse(CORS_HEADERS);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return Response.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/token`,
    registration_endpoint: `${baseUrl}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["open-brain"],
    service_documentation: `${baseUrl}/getting-started`,
  }, { headers: CORS_HEADERS });
}
