import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConvexMcpToken,
  getPublicMcpJwk,
  MCP_JWT_ALGORITHM,
  MCP_JWT_AUDIENCE,
} from "./convex-auth";

describe("MCP Convex JWTs", () => {
  beforeEach(async () => {
    const { privateKey, publicKey } = await generateKeyPair(MCP_JWT_ALGORITHM, {
      extractable: true,
    });
    vi.stubEnv("MCP_JWT_ISSUER", "https://brain.example.test");
    vi.stubEnv("MCP_JWT_KEY_ID", "test-key");
    vi.stubEnv(
      "MCP_JWT_PRIVATE_JWK",
      JSON.stringify(await exportJWK(privateKey)),
    );
    vi.stubEnv(
      "MCP_JWT_PUBLIC_JWK",
      JSON.stringify(await exportJWK(publicKey)),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints a short-lived token bound to the authenticated user", async () => {
    const token = await createConvexMcpToken({
      userId: "user-123",
      keyId: "key-456",
    });
    const publicKey = await importJWK(getPublicMcpJwk(), MCP_JWT_ALGORITHM);
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      issuer: "https://brain.example.test",
      audience: MCP_JWT_AUDIENCE,
    });

    expect(protectedHeader.kid).toBe("test-key");
    expect(payload.sub).toBe("user-123");
    expect(payload.apiKeyId).toBe("key-456");
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it("fails closed when the signing key is missing", async () => {
    vi.stubEnv("MCP_JWT_PRIVATE_JWK", "");

    await expect(
      createConvexMcpToken({ userId: "user-123", keyId: "key-456" }),
    ).rejects.toThrow("MCP_JWT_PRIVATE_JWK is not set");
  });

  it("never publishes private key material", async () => {
    vi.stubEnv("MCP_JWT_PUBLIC_JWK", process.env.MCP_JWT_PRIVATE_JWK ?? "");

    expect(() => getPublicMcpJwk()).toThrow(
      "MCP_JWT_PUBLIC_JWK must not contain private key material",
    );
  });
});
