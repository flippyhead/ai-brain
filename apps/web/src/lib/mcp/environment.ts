const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const KEY_ID = /^[A-Za-z0-9._~-]{1,128}$/;

export const REQUIRED_MCP_ENVIRONMENT_VARIABLES = [
  "NEXT_PUBLIC_CONVEX_URL",
  "MCP_JWT_ISSUER",
  "MCP_JWT_PRIVATE_JWK",
  "MCP_JWT_PUBLIC_JWK",
  "MCP_OAUTH_ENCRYPTION_KEY",
] as const;

export type McpEnvironmentVariable =
  | (typeof REQUIRED_MCP_ENVIRONMENT_VARIABLES)[number]
  | "MCP_JWT_KEY_ID"
  | "MCP_TOOL_PROFILE";

export type McpEnvironmentIssue = {
  name: McpEnvironmentVariable;
  problem: "missing" | "invalid";
};

type Environment = Readonly<Record<string, string | undefined>>;

type P256JwkCoordinates = {
  x: string;
  y: string;
};

export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function isAllowedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const isSecure = url.protocol === "https:";
    const isLoopbackDevelopmentOrigin =
      url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

    return (
      (isSecure || isLoopbackDevelopmentOrigin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      value === url.origin
    );
  } catch {
    return false;
  }
}

function parseP256Jwk(
  value: string,
  privateKey: boolean,
): P256JwkCoordinates | undefined {
  try {
    const key = JSON.parse(value) as Record<string, unknown>;
    if (
      !key ||
      key.kty !== "EC" ||
      key.crv !== "P-256" ||
      typeof key.x !== "string" ||
      !BASE64URL_32_BYTES.test(key.x) ||
      typeof key.y !== "string" ||
      !BASE64URL_32_BYTES.test(key.y) ||
      (privateKey
        ? typeof key.d !== "string" || !BASE64URL_32_BYTES.test(key.d)
        : "d" in key)
    ) {
      return undefined;
    }
    return { x: key.x, y: key.y };
  } catch {
    return undefined;
  }
}

/**
 * Validates the complete Next.js MCP gateway configuration without returning
 * or interpolating any configured values. This is safe to expose from a
 * health check or log because issues contain variable names only.
 */
export function validateMcpEnvironment(
  environment: Environment = process.env,
): McpEnvironmentIssue[] {
  const issues: McpEnvironmentIssue[] = [];
  const requiredValues = new Map<McpEnvironmentVariable, string>();

  for (const name of REQUIRED_MCP_ENVIRONMENT_VARIABLES) {
    const value = environment[name];
    if (!value) {
      issues.push({ name, problem: "missing" });
    } else {
      requiredValues.set(name, value);
    }
  }

  const convexUrl = requiredValues.get("NEXT_PUBLIC_CONVEX_URL");
  if (convexUrl && !isAllowedOrigin(convexUrl)) {
    issues.push({ name: "NEXT_PUBLIC_CONVEX_URL", problem: "invalid" });
  }

  const issuer = requiredValues.get("MCP_JWT_ISSUER");
  if (issuer && !isAllowedOrigin(issuer)) {
    issues.push({ name: "MCP_JWT_ISSUER", problem: "invalid" });
  }

  const privateJwkValue = requiredValues.get("MCP_JWT_PRIVATE_JWK");
  const privateJwk = privateJwkValue
    ? parseP256Jwk(privateJwkValue, true)
    : undefined;
  if (privateJwkValue && !privateJwk) {
    issues.push({ name: "MCP_JWT_PRIVATE_JWK", problem: "invalid" });
  }

  const publicJwkValue = requiredValues.get("MCP_JWT_PUBLIC_JWK");
  const publicJwk = publicJwkValue
    ? parseP256Jwk(publicJwkValue, false)
    : undefined;
  if (publicJwkValue && !publicJwk) {
    issues.push({ name: "MCP_JWT_PUBLIC_JWK", problem: "invalid" });
  }

  if (
    privateJwk &&
    publicJwk &&
    (privateJwk.x !== publicJwk.x || privateJwk.y !== publicJwk.y)
  ) {
    issues.push({ name: "MCP_JWT_PRIVATE_JWK", problem: "invalid" });
    issues.push({ name: "MCP_JWT_PUBLIC_JWK", problem: "invalid" });
  }

  const encryptionKey = requiredValues.get("MCP_OAUTH_ENCRYPTION_KEY");
  if (encryptionKey && !BASE64URL_32_BYTES.test(encryptionKey)) {
    issues.push({ name: "MCP_OAUTH_ENCRYPTION_KEY", problem: "invalid" });
  }

  const keyId = environment.MCP_JWT_KEY_ID;
  if (keyId !== undefined && !KEY_ID.test(keyId)) {
    issues.push({ name: "MCP_JWT_KEY_ID", problem: "invalid" });
  }

  const toolProfile = environment.MCP_TOOL_PROFILE;
  if (
    toolProfile !== undefined &&
    toolProfile !== "" &&
    toolProfile !== "memory" &&
    toolProfile !== "full"
  ) {
    issues.push({ name: "MCP_TOOL_PROFILE", problem: "invalid" });
  }

  return issues;
}

export function assertMcpEnvironment(
  environment: Environment = process.env,
): void {
  const issues = validateMcpEnvironment(environment);
  if (issues.length > 0) {
    const summary = issues
      .map(({ name, problem }) => `${problem}: ${name}`)
      .join(", ");
    throw new Error(`Invalid MCP environment configuration (${summary})`);
  }
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
