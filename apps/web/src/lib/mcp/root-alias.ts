/**
 * Some hosted MCP clients retain only the authorization-server origin after
 * OAuth. Accept their JSON-RPC POSTs at the origin without changing normal
 * browser navigation or Next.js form/server-action requests.
 */
export function shouldRewriteMcpRootRequest(
  pathname: string,
  method: string,
  contentType: string | null,
): boolean {
  return (
    pathname === "/" &&
    method === "POST" &&
    (contentType ?? "").toLowerCase().includes("application/json")
  );
}
