// Backwards-compat: redirect old API authorize URL to the React page
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = new URL("/mcp/authorize", url.origin);
  target.search = url.search;
  return Response.redirect(target.toString(), 302);
}
