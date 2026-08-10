import { validateMcpEnvironment } from "@/lib/mcp/environment";

export const dynamic = "force-dynamic";

export async function GET() {
  const issues = validateMcpEnvironment();
  if (issues.length > 0) {
    return Response.json(
      {
        status: "misconfigured",
        service: "open-brain-mcp",
        issues,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  return Response.json({
    status: "ok",
    service: "open-brain-mcp",
    timestamp: new Date().toISOString(),
  });
}
