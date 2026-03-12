export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "open-brain-mcp",
    timestamp: new Date().toISOString(),
  });
}
