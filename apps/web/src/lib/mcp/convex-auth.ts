import { importJWK, type JWK, SignJWT } from "jose";

export const MCP_JWT_AUDIENCE = "ai-brain-convex-mcp";
export const MCP_JWT_ALGORITHM = "ES256";

type McpIdentity = {
  userId: string;
  keyId: string;
};

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function parseJwk(value: string, variableName: string): JWK {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || !("kty" in parsed)) {
      throw new Error("expected a JSON Web Key");
    }
    return parsed as JWK;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${variableName} is invalid: ${reason}`);
  }
}

function requireP256Key(key: JWK, variableName: string): void {
  if (key.kty !== "EC" || key.crv !== "P-256" || !key.x || !key.y) {
    throw new Error(`${variableName} must be an EC P-256 JSON Web Key`);
  }
}

export function getPublicMcpJwk(): JWK & { kid: string } {
  const key = parseJwk(
    requireEnvironmentVariable("MCP_JWT_PUBLIC_JWK"),
    "MCP_JWT_PUBLIC_JWK",
  );
  requireP256Key(key, "MCP_JWT_PUBLIC_JWK");
  if (key.d) {
    throw new Error("MCP_JWT_PUBLIC_JWK must not contain private key material");
  }
  return {
    ...key,
    alg: MCP_JWT_ALGORITHM,
    use: "sig",
    kid: process.env.MCP_JWT_KEY_ID ?? "mcp-1",
  };
}

export async function createConvexMcpToken(
  identity: McpIdentity,
): Promise<string> {
  const issuer = requireEnvironmentVariable("MCP_JWT_ISSUER");
  const privateJwk = parseJwk(
    requireEnvironmentVariable("MCP_JWT_PRIVATE_JWK"),
    "MCP_JWT_PRIVATE_JWK",
  );
  requireP256Key(privateJwk, "MCP_JWT_PRIVATE_JWK");
  if (!privateJwk.d) {
    throw new Error("MCP_JWT_PRIVATE_JWK must contain private key material");
  }
  const keyId = process.env.MCP_JWT_KEY_ID ?? "mcp-1";
  const signingKey = await importJWK(privateJwk, MCP_JWT_ALGORITHM);

  return await new SignJWT({ apiKeyId: identity.keyId })
    .setProtectedHeader({
      alg: MCP_JWT_ALGORITHM,
      kid: keyId,
      typ: "JWT",
    })
    .setIssuer(issuer)
    .setAudience(MCP_JWT_AUDIENCE)
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(crypto.randomUUID())
    .sign(signingKey);
}
