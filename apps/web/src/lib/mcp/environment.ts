const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function getMcpIssuer(): string {
  const configuredIssuer = requireEnvironmentVariable("MCP_JWT_ISSUER");
  let issuer: URL;

  try {
    issuer = new URL(configuredIssuer);
  } catch {
    throw new Error("MCP_JWT_ISSUER must be an absolute URL origin");
  }

  const isSecure = issuer.protocol === "https:";
  const isLoopbackDevelopmentOrigin =
    issuer.protocol === "http:" && LOOPBACK_HOSTS.has(issuer.hostname);

  if (
    (!isSecure && !isLoopbackDevelopmentOrigin) ||
    issuer.username ||
    issuer.password ||
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash ||
    configuredIssuer !== issuer.origin
  ) {
    throw new Error(
      "MCP_JWT_ISSUER must be an HTTPS origin without a path or trailing slash",
    );
  }

  return issuer.origin;
}

export function getMcpResourceUri(): string {
  return `${getMcpIssuer()}/api/mcp`;
}

export function isMcpResourceUri(value: string): boolean {
  try {
    const resource = new URL(value);
    return (
      !resource.username &&
      !resource.password &&
      !resource.search &&
      !resource.hash &&
      `${resource.origin}${resource.pathname}` === getMcpResourceUri()
    );
  } catch {
    return false;
  }
}
