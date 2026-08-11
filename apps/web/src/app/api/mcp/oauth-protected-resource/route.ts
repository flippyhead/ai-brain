import { createCorsHeaders, createCorsOptionsResponse } from "@/lib/mcp/cors";
import { getMcpIssuer, getMcpResourceUri } from "@/lib/mcp/environment";

const CORS_HEADERS = createCorsHeaders("GET, OPTIONS");

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return createCorsOptionsResponse(CORS_HEADERS);
}

export async function GET() {
  const baseUrl = getMcpIssuer();

  return Response.json(
    {
      resource: getMcpResourceUri(),
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
    },
    { headers: CORS_HEADERS },
  );
}
