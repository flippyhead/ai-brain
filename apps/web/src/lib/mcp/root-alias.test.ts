import { describe, expect, it } from "vitest";

import { shouldRewriteMcpRootRequest } from "./root-alias";

const BEARER = "Bearer ob_0123456789abcdef";

describe("MCP root compatibility alias", () => {
  it("rewrites authenticated JSON-RPC posts at the public origin", () => {
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", BEARER),
    ).toBe(true);
    expect(
      shouldRewriteMcpRootRequest(
        "/",
        "POST",
        "application/json; charset=utf-8",
        BEARER,
      ),
    ).toBe(true);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", "bearer x"),
    ).toBe(true);
  });

  it("does not intercept dashboard navigation or Next.js submissions", () => {
    expect(shouldRewriteMcpRootRequest("/", "GET", null, BEARER)).toBe(false);
    expect(
      shouldRewriteMcpRootRequest(
        "/api/mcp",
        "POST",
        "application/json",
        BEARER,
      ),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "multipart/form-data", BEARER),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest(
        "/",
        "POST",
        "text/plain;charset=UTF-8",
        BEARER,
      ),
    ).toBe(false);
  });

  it("leaves unauthenticated JSON posts on the dashboard route", () => {
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", null),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", ""),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", "Bearer"),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "application/json", "Basic abc"),
    ).toBe(false);
  });
});
