import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as registerClient } from "../../app/api/mcp/register/route";
import {
  getMcpIssuer,
  getMcpResourceUri,
  isMcpResourceUri,
} from "./environment";
import {
  decryptAuthCode,
  decryptClientRegistration,
  encryptAuthCode,
  encryptClientRegistration,
  hasTrustedOAuthOrigin,
  readLimitedOAuthBody,
  verifyCodeChallenge,
} from "./oauth";
import {
  authorizationRequestSchema,
  clientRegistrationRequestSchema,
  isAllowedOAuthRedirectUri,
  tokenRequestSchema,
} from "./oauth-validation";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("MCP OAuth security", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_JWT_ISSUER", "https://brain.example.test");
    vi.stubEnv(
      "MCP_OAUTH_ENCRYPTION_KEY",
      crypto.randomBytes(32).toString("base64url"),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only a canonical HTTPS issuer or loopback development origin", () => {
    expect(getMcpIssuer()).toBe("https://brain.example.test");

    vi.stubEnv("MCP_JWT_ISSUER", "http://localhost:3000");
    expect(getMcpIssuer()).toBe("http://localhost:3000");

    for (const invalid of [
      "http://brain.example.test",
      "https://brain.example.test/",
      "https://brain.example.test/path",
      "https://user:pass@brain.example.test",
    ]) {
      vi.stubEnv("MCP_JWT_ISSUER", invalid);
      expect(() => getMcpIssuer()).toThrow();
    }
  });

  it("validates registered redirect URIs and OAuth request shapes", () => {
    expect(
      isAllowedOAuthRedirectUri("https://chatgpt.com/oauth/callback"),
    ).toBe(true);
    expect(isAllowedOAuthRedirectUri("http://localhost:4567/callback")).toBe(
      true,
    );
    expect(getMcpResourceUri()).toBe("https://brain.example.test/api/mcp");
    expect(isMcpResourceUri("HTTPS://BRAIN.EXAMPLE.TEST/api/mcp")).toBe(true);
    expect(isMcpResourceUri("https://brain.example.test/other")).toBe(false);

    for (const invalid of [
      "http://example.com/callback",
      "javascript:alert(1)",
      "https://user:pass@example.com/callback",
      "https://example.com/callback#fragment",
      "/relative/callback",
    ]) {
      expect(isAllowedOAuthRedirectUri(invalid)).toBe(false);
    }

    expect(
      clientRegistrationRequestSchema.safeParse({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        application_type: "web",
      }).success,
    ).toBe(true);
    expect(
      clientRegistrationRequestSchema.safeParse({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["refresh_token"],
      }).success,
    ).toBe(false);
    expect(
      authorizationRequestSchema.safeParse({
        clientId: "registered-client",
        redirectUri: "https://chatgpt.com/oauth/callback",
        resource: "https://brain.example.test/api/mcp",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        responseType: "code",
      }).success,
    ).toBe(true);
    expect(
      authorizationRequestSchema.safeParse({
        clientId: "registered-client",
        redirectUri: "https://chatgpt.com/oauth/callback",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        responseType: "code",
      }).success,
    ).toBe(true);
    expect(
      authorizationRequestSchema.safeParse({
        clientId: "registered-client",
        redirectUri: "https://chatgpt.com/oauth/callback",
        resource: "",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        responseType: "code",
      }).success,
    ).toBe(false);
    expect(
      tokenRequestSchema.safeParse({
        grant_type: "authorization_code",
        code: "authorization-code",
        code_verifier: verifier,
        redirect_uri: "https://chatgpt.com/oauth/callback",
        client_id: "registered-client",
        resource: "https://brain.example.test/api/mcp",
      }).success,
    ).toBe(true);
    expect(
      tokenRequestSchema.safeParse({
        grant_type: "authorization_code",
        code: "authorization-code",
        code_verifier: verifier,
        redirect_uri: "https://chatgpt.com/oauth/callback",
        client_id: "registered-client",
      }).success,
    ).toBe(true);
  });

  it("binds encrypted client registrations to exact redirect URIs", () => {
    const registration = {
      clientName: "ChatGPT",
      redirectUris: ["https://chatgpt.com/oauth/callback"],
      issuedAt: Date.now(),
    };
    const clientId = encryptClientRegistration(registration);

    expect(decryptClientRegistration(clientId)).toEqual(registration);
    expect(decryptClientRegistration(`${clientId}tampered`)).toBeNull();
    expect(decryptAuthCode(clientId)).toBeNull();

    vi.stubEnv(
      "MCP_OAUTH_ENCRYPTION_KEY",
      crypto.randomBytes(32).toString("base64url"),
    );
    expect(decryptClientRegistration(clientId)).toBeNull();
  });

  it("registers MCP clients that advertise refresh support without overclaiming server grants", async () => {
    const response = await registerClient(
      new Request("https://brain.example.test/api/mcp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none",
          application_type: "web",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      client_id?: unknown;
      grant_types?: unknown;
      application_type?: unknown;
    };
    expect(typeof body.client_id).toBe("string");
    expect(body.grant_types).toEqual(["authorization_code"]);
    expect(body.application_type).toBe("web");
    expect(decryptClientRegistration(body.client_id as string)).toMatchObject({
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });

    const invalid = await registerClient(
      new Request("https://brain.example.test/api/mcp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://attacker.example.test/callback"],
        }),
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("encrypts authorization codes without confusing token types", () => {
    const payload = {
      apiKey: `ob_${"a".repeat(64)}`,
      clientId: "registered-client",
      redirectUri: "https://chatgpt.com/oauth/callback",
      resource: "https://brain.example.test/api/mcp",
      codeChallenge: challenge,
      scope: "open-brain" as const,
      exp: Date.now() + 300_000,
    };
    const code = encryptAuthCode(payload);

    expect(decryptAuthCode(code)).toEqual(payload);
    expect(decryptClientRegistration(code)).toBeNull();
  });

  it("verifies RFC 7636 S256 challenges in constant-time code paths", () => {
    expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    expect(verifyCodeChallenge(`${verifier}x`, challenge)).toBe(false);
    expect(verifyCodeChallenge("short", challenge)).toBe(false);
    expect(verifyCodeChallenge(verifier, "invalid")).toBe(false);
  });

  it("requires same-origin authorization and limits request bodies", async () => {
    const trusted = new Request("https://brain.example.test/api/mcp/token", {
      headers: { Origin: "https://brain.example.test" },
    });
    const untrusted = new Request("https://brain.example.test/api/mcp/token", {
      headers: { Origin: "https://attacker.example.test" },
    });

    expect(hasTrustedOAuthOrigin(trusted)).toBe(true);
    expect(hasTrustedOAuthOrigin(untrusted)).toBe(false);

    const oversized = new Request("https://brain.example.test/api/mcp/token", {
      method: "POST",
      body: "x".repeat(16 * 1024 + 1),
    });
    await expect(readLimitedOAuthBody(oversized)).rejects.toThrow(
      "OAuth request body is too large",
    );
  });

  it("fails closed when the OAuth encryption key is absent or malformed", () => {
    vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", "");
    expect(() =>
      encryptClientRegistration({
        clientName: "ChatGPT",
        redirectUris: ["https://chatgpt.com/oauth/callback"],
        issuedAt: Date.now(),
      }),
    ).toThrow("MCP_OAUTH_ENCRYPTION_KEY is not set");

    vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", "not-a-key");
    expect(() =>
      encryptClientRegistration({
        clientName: "ChatGPT",
        redirectUris: ["https://chatgpt.com/oauth/callback"],
        issuedAt: Date.now(),
      }),
    ).toThrow("base64url-encoded 32-byte key");
  });
});
