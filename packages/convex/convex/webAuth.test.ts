import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const mcpIssuer = "https://brain.example.test";
const sessionIssuer = "https://brain.example.test/convex";

describe("web session boundary", () => {
  const originalIssuer = process.env.MCP_JWT_ISSUER;

  beforeEach(() => {
    process.env.MCP_JWT_ISSUER = mcpIssuer;
  });

  afterEach(() => {
    if (originalIssuer === undefined) {
      delete process.env.MCP_JWT_ISSUER;
    } else {
      process.env.MCP_JWT_ISSUER = originalIssuer;
    }
  });

  test("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.models.thoughts.public.getStats, {})).rejects.toThrow(
      "Not authenticated",
    );
  });

  test("accepts a dashboard session identity", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const session = t.withIdentity({ issuer: sessionIssuer, subject: userId });

    const stats = await session.query(api.models.thoughts.public.getStats, {});
    expect(stats.totalThoughts).toBe(0);
  });

  test("refuses MCP-issued identities on the dashboard surface", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    // A token minted by the MCP gateway from an API key. getAuthUserId would
    // accept it because it only reads `subject`; requireWebUserId must not.
    const mcp = t.withIdentity({ issuer: mcpIssuer, subject: userId });

    await expect(
      mcp.query(api.models.thoughts.public.getStats, {}),
    ).rejects.toThrow("Not authenticated");

    await expect(
      mcp.mutation(api.models.apiKeys.public.create, { name: "escalated" }),
    ).rejects.toThrow("Not authenticated");
  });
});
