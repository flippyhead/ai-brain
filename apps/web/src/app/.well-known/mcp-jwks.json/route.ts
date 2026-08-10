import { getPublicMcpJwk } from "@/lib/mcp/convex-auth";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { keys: [getPublicMcpJwk()] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
