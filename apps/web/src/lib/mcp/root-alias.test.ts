import { describe, expect, it } from "vitest";

import { shouldRewriteMcpRootRequest } from "./root-alias";

describe("MCP root compatibility alias", () => {
  it("rewrites JSON-RPC posts at the public origin", () => {
    expect(shouldRewriteMcpRootRequest("/", "POST", "application/json")).toBe(
      true,
    );
    expect(
      shouldRewriteMcpRootRequest(
        "/",
        "POST",
        "application/json; charset=utf-8",
      ),
    ).toBe(true);
  });

  it("does not intercept dashboard navigation or Next.js submissions", () => {
    expect(shouldRewriteMcpRootRequest("/", "GET", null)).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/api/mcp", "POST", "application/json"),
    ).toBe(false);
    expect(
      shouldRewriteMcpRootRequest("/", "POST", "multipart/form-data"),
    ).toBe(false);
  });
});
