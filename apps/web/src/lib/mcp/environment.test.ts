import { describe, expect, it } from "vitest";

import { assertMcpEnvironment, validateMcpEnvironment } from "./environment";

const privateJwk = JSON.stringify({
  kty: "EC",
  crv: "P-256",
  x: "A".repeat(43),
  y: `${"B".repeat(42)}E`,
  d: `${"C".repeat(42)}I`,
});
const publicJwk = JSON.stringify({
  kty: "EC",
  crv: "P-256",
  x: "A".repeat(43),
  y: `${"B".repeat(42)}E`,
});

function validEnvironment(): Record<string, string> {
  return {
    NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
    MCP_JWT_ISSUER: "https://brain.example.test",
    MCP_JWT_PRIVATE_JWK: privateJwk,
    MCP_JWT_PUBLIC_JWK: publicJwk,
    MCP_JWT_KEY_ID: "mcp-test-key",
    MCP_OAUTH_ENCRYPTION_KEY: "A".repeat(43),
    MCP_TOOL_PROFILE: "memory",
  };
}

describe("validateMcpEnvironment", () => {
  it("accepts a complete production configuration", () => {
    expect(validateMcpEnvironment(validEnvironment())).toEqual([]);
    expect(() => assertMcpEnvironment(validEnvironment())).not.toThrow();
  });

  it("accepts HTTP only for loopback development origins", () => {
    const environment = validEnvironment();
    environment.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210";
    environment.MCP_JWT_ISSUER = "http://localhost:3000";

    expect(validateMcpEnvironment(environment)).toEqual([]);
  });

  it("reports missing variables by name without including values", () => {
    const issues = validateMcpEnvironment({});

    expect(issues).toEqual([
      { name: "NEXT_PUBLIC_CONVEX_URL", problem: "missing" },
      { name: "MCP_JWT_ISSUER", problem: "missing" },
      { name: "MCP_JWT_PRIVATE_JWK", problem: "missing" },
      { name: "MCP_JWT_PUBLIC_JWK", problem: "missing" },
      { name: "MCP_OAUTH_ENCRYPTION_KEY", problem: "missing" },
    ]);
  });

  it("rejects malformed origins, keys, and key IDs", () => {
    const environment = validEnvironment();
    environment.NEXT_PUBLIC_CONVEX_URL = "http://convex.example.test";
    environment.MCP_JWT_ISSUER = "https://brain.example.test/path";
    environment.MCP_JWT_PRIVATE_JWK = "not-json";
    environment.MCP_JWT_PUBLIC_JWK = JSON.stringify({
      ...JSON.parse(publicJwk),
      d: "private-material",
    });
    environment.MCP_JWT_KEY_ID = "contains spaces";
    environment.MCP_OAUTH_ENCRYPTION_KEY = "too-short";
    environment.MCP_TOOL_PROFILE = "everything";

    expect(validateMcpEnvironment(environment)).toEqual([
      { name: "NEXT_PUBLIC_CONVEX_URL", problem: "invalid" },
      { name: "MCP_JWT_ISSUER", problem: "invalid" },
      { name: "MCP_JWT_PRIVATE_JWK", problem: "invalid" },
      { name: "MCP_JWT_PUBLIC_JWK", problem: "invalid" },
      { name: "MCP_OAUTH_ENCRYPTION_KEY", problem: "invalid" },
      { name: "MCP_JWT_KEY_ID", problem: "invalid" },
      { name: "MCP_TOOL_PROFILE", problem: "invalid" },
    ]);
  });

  it("rejects a public key that does not match the private key", () => {
    const environment = validEnvironment();
    environment.MCP_JWT_PUBLIC_JWK = JSON.stringify({
      ...JSON.parse(publicJwk),
      x: `${"D".repeat(42)}M`,
    });

    expect(validateMcpEnvironment(environment)).toEqual([
      { name: "MCP_JWT_PRIVATE_JWK", problem: "invalid" },
      { name: "MCP_JWT_PUBLIC_JWK", problem: "invalid" },
    ]);
  });

  it("throws an error containing names only", () => {
    const secretValue = "do-not-leak-this-value";
    const environment = validEnvironment();
    environment.MCP_JWT_PRIVATE_JWK = secretValue;

    expect(() => assertMcpEnvironment(environment)).toThrow(
      "invalid: MCP_JWT_PRIVATE_JWK",
    );
    try {
      assertMcpEnvironment(environment);
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
    }
  });
});
