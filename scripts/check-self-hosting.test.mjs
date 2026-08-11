import assert from "node:assert/strict";
import test from "node:test";

import {
  formatIssues,
  validateConvexVariableNames,
  validateWebEnvironment,
} from "./check-self-hosting.mjs";

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

function validWebEnvironment() {
  return {
    NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
    MCP_JWT_ISSUER: "https://brain.example.test",
    MCP_JWT_PRIVATE_JWK: privateJwk,
    MCP_JWT_PUBLIC_JWK: publicJwk,
    MCP_JWT_KEY_ID: "mcp-test",
    MCP_OAUTH_ENCRYPTION_KEY: "A".repeat(43),
    MCP_TOOL_PROFILE: "memory",
  };
}

test("web preflight accepts complete configuration", () => {
  assert.deepEqual(validateWebEnvironment(validWebEnvironment()), []);
});

test("web preflight returns names only for missing variables", () => {
  assert.deepEqual(validateWebEnvironment({}), [
    { name: "NEXT_PUBLIC_CONVEX_URL", problem: "missing" },
    { name: "MCP_JWT_ISSUER", problem: "missing" },
    { name: "MCP_JWT_PRIVATE_JWK", problem: "missing" },
    { name: "MCP_JWT_PUBLIC_JWK", problem: "missing" },
    { name: "MCP_OAUTH_ENCRYPTION_KEY", problem: "missing" },
  ]);
});

test("web preflight rejects malformed and mismatched values", () => {
  const environment = validWebEnvironment();
  environment.MCP_JWT_ISSUER = "http://public.example.test";
  environment.MCP_JWT_PUBLIC_JWK = JSON.stringify({
    ...JSON.parse(publicJwk),
    y: `${"D".repeat(42)}M`,
  });
  environment.MCP_OAUTH_ENCRYPTION_KEY = "short";
  environment.MCP_TOOL_PROFILE = "everything";

  assert.deepEqual(validateWebEnvironment(environment), [
    { name: "MCP_JWT_ISSUER", problem: "invalid" },
    { name: "MCP_JWT_PRIVATE_JWK", problem: "invalid" },
    { name: "MCP_JWT_PUBLIC_JWK", problem: "invalid" },
    { name: "MCP_OAUTH_ENCRYPTION_KEY", problem: "invalid" },
    { name: "MCP_TOOL_PROFILE", problem: "invalid" },
  ]);
});

test("formatted output cannot include a rejected secret value", () => {
  const secretValue = "a-secret-that-must-not-appear";
  const environment = validWebEnvironment();
  environment.MCP_JWT_PRIVATE_JWK = secretValue;

  const output = formatIssues("web", validateWebEnvironment(environment)).join(
    "\n",
  );
  assert.match(output, /web: invalid MCP_JWT_PRIVATE_JWK/u);
  assert.doesNotMatch(output, new RegExp(secretValue, "u"));
});

test("Convex preflight checks names without needing values", () => {
  assert.deepEqual(
    validateConvexVariableNames(["OPENAI_API_KEY", "MCP_JWT_ISSUER"]),
    [
      { name: "ANTHROPIC_API_KEY", problem: "missing" },
      { name: "SITE_URL", problem: "missing" },
      { name: "JWT_PRIVATE_KEY", problem: "missing" },
      { name: "JWKS", problem: "missing" },
    ],
  );
});
