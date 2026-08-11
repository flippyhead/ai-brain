/**
 * Some hosted MCP clients retain only the authorization-server origin after
 * OAuth. Accept their JSON-RPC POSTs at the origin without changing normal
 * browser navigation or Next.js form/server-action requests.
 *
 * The bearer credential is required as well as the JSON content type. Server
 * actions currently post as text/plain or multipart, but that is a framework
 * implementation detail rather than a guarantee; requiring the Authorization
 * header keeps the rewrite scoped to authenticated MCP traffic instead of
 * turning the dashboard root into a general JSON endpoint.
 */
export function shouldRewriteMcpRootRequest(
  pathname: string,
  method: string,
  contentType: string | null,
  authorization: string | null,
): boolean {
  return (
    pathname === "/" &&
    method === "POST" &&
    (contentType ?? "").toLowerCase().includes("application/json") &&
    /^bearer\s+\S/i.test(authorization ?? "")
  );
}
