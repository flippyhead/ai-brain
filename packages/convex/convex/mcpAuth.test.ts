import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const issuer = "https://brain.example.test";

describe("MCP account isolation", () => {
  const originalIssuer = process.env.MCP_JWT_ISSUER;

  beforeEach(() => {
    process.env.MCP_JWT_ISSUER = issuer;
  });

  afterEach(() => {
    if (originalIssuer === undefined) {
      delete process.env.MCP_JWT_ISSUER;
    } else {
      process.env.MCP_JWT_ISSUER = originalIssuer;
    }
  });

  test("rejects missing and untrusted identities", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.models.lists.mcpQueries.getLists, {}),
    ).rejects.toThrow("Not authenticated");

    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const untrusted = t.withIdentity({
      issuer: "https://attacker.example.test",
      subject: userId,
    });

    await expect(
      untrusted.query(api.models.lists.mcpQueries.getLists, {}),
    ).rejects.toThrow("Not authenticated");
  });

  test("uses the signed subject and prevents cross-account reads", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { name: "Owner" }),
      await ctx.db.insert("users", { name: "Other" }),
    ]);
    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });

    const created = await owner.mutation(
      api.models.lists.mcpActions.createList,
      { name: "Private", pinned: false },
    );

    await expect(
      other.query(api.models.lists.mcpQueries.getList, {
        listId: created.listId,
      }),
    ).rejects.toThrow("List not found");

    const result = await owner.query(api.models.lists.mcpQueries.getList, {
      listId: created.listId,
    });
    expect(result.name).toBe("Private");
  });

  test("does not accept a caller-supplied userId override", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });

    const created = await owner.mutation(
      api.models.lists.mcpActions.createList,
      { name: "Private", pinned: false },
    );

    await expect(
      other.query(api.models.lists.mcpQueries.getList, {
        listId: created.listId,
        userId: ownerId,
      } as never),
    ).rejects.toThrow();
  });

  test("checks ownership before deleting an insight", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });
    const insightId = await t.run(async (ctx) => {
      const reportId = await ctx.db.insert("reports", {
        userId: ownerId,
        startDate: "2026-08-01",
        endDate: "2026-08-10",
        sessionsAnalyzed: 1,
        totalPrompts: 1,
        totalToolCalls: 1,
        projectsActive: [],
        modelUsage: {},
      });
      return await ctx.db.insert("insights", {
        reportId,
        userId: ownerId,
        category: "productivity",
        observation: "A private observation",
        recommendation: "Keep it private",
        evidence: "Private evidence",
        status: "new",
      });
    });

    await expect(
      other.mutation(api.models.reports.mcpMutations.deleteInsight, {
        insightId,
      }),
    ).rejects.toThrow("Insight not found");

    await owner.mutation(api.models.reports.mcpMutations.deleteInsight, {
      insightId,
    });
    expect(await t.run((ctx) => ctx.db.get(insightId))).toBeNull();
  });
});
