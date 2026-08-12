import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";

const issuer = "https://brain.example.test";
const embedding = Array.from({ length: 1536 }, () => 0);
const metadata = {
  type: "person_note" as const,
  topics: ["identity"],
  people: [],
  actionItems: [],
  summary: "Core identity fact",
};

describe("core memories", () => {
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

  test("returns a bounded current core set for only the authenticated account", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index++) {
        await ctx.db.insert("thoughts", {
          userId: ownerId,
          content: `Owner core memory ${index}`,
          embedding,
          metadata,
          isCore: true,
          memoryStatus: "current",
        });
      }
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner non-core memory",
        embedding,
        metadata,
        isCore: false,
        memoryStatus: "current",
      });
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner expired core memory",
        embedding,
        metadata,
        isCore: true,
        memoryStatus: "current",
        validTo: Date.now() - 60_000,
      });
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner future core memory",
        embedding,
        metadata,
        isCore: true,
        memoryStatus: "current",
        validFrom: Date.now() + 60_000,
      });
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner historical core memory",
        embedding,
        metadata,
        isCore: true,
        memoryStatus: "superseded",
      });
      await ctx.db.insert("thoughts", {
        userId: otherId,
        content: "Other account core memory",
        embedding,
        metadata,
        isCore: true,
        memoryStatus: "current",
      });
      // These are newer than the retrievable core set. The previous fixed
      // 250-candidate window returned nothing once enough history accumulated.
      for (let index = 0; index < 260; index += 1) {
        await ctx.db.insert("thoughts", {
          userId: ownerId,
          content: `Owner retracted core memory ${index}`,
          embedding,
          metadata,
          isCore: true,
          memoryStatus: "retracted",
        });
      }
    });

    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });
    await expect(
      t.query(api.models.thoughts.mcpQueries.listCore, {}),
    ).rejects.toThrow("Not authenticated");
    const ownerResults = await owner.query(
      api.models.thoughts.mcpQueries.listCore,
      { limit: 100 },
    );
    const otherResults = await other.query(
      api.models.thoughts.mcpQueries.listCore,
      {},
    );

    expect(ownerResults).toHaveLength(25);
    expect(
      ownerResults.every(
        (memory) =>
          memory.userId === ownerId &&
          memory.isCore === true &&
          memory.memoryStatus === "current" &&
          memory.content.startsWith("Owner core memory"),
      ),
    ).toBe(true);
    expect(otherResults.map((memory) => memory.content)).toEqual([
      "Other account core memory",
    ]);
    await expect(
      owner.query(api.models.thoughts.mcpQueries.listCore, { limit: 0 }),
    ).rejects.toThrow("Core memory limit must be a positive integer");
  });

  test("inherits core status across transitions unless explicitly overridden", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const [originalId, nonCoreId] = await t.run(async (ctx) => [
      await ctx.db.insert("thoughts", {
        userId,
        content: "A durable core fact",
        embedding,
        metadata,
        isCore: true,
        memoryStatus: "current",
      }),
      await ctx.db.insert("thoughts", {
        userId,
        content: "A related non-core fact",
        embedding,
        metadata,
        isCore: false,
        memoryStatus: "current",
      }),
    ]);

    const inheritedId = await t.mutation(
      internal.models.thoughts.private.transitionMemory,
      {
        userId,
        content: "An updated durable core fact",
        embedding,
        metadata,
        previousIds: [originalId, nonCoreId],
        previousStatus: "superseded",
        reason: "The core fact changed",
        transitionedAt: Date.now(),
      },
    );
    const explicitlyNonCoreId = await t.mutation(
      internal.models.thoughts.private.transitionMemory,
      {
        userId,
        content: "The fact no longer belongs in always-on context",
        embedding,
        metadata,
        previousIds: [inheritedId],
        previousStatus: "superseded",
        reason: "The user explicitly removed core status",
        transitionedAt: Date.now(),
        isCore: false,
      },
    );

    const [inherited, explicitlyNonCore] = await t.run(async (ctx) => [
      await ctx.db.get(inheritedId),
      await ctx.db.get(explicitlyNonCoreId),
    ]);
    expect(inherited?.isCore).toBe(true);
    expect(explicitlyNonCore?.isCore).toBe(false);
  });

  test("prevents cross-account core updates and transitions without partial writes", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const [ownerMemoryId, otherMemoryId] = await t.run(async (ctx) => [
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner core memory",
        embedding,
        metadata,
        isCore: true,
      }),
      await ctx.db.insert("thoughts", {
        userId: otherId,
        content: "Other memory",
        embedding,
        metadata,
        isCore: false,
      }),
    ]);

    await expect(
      t.mutation(internal.models.thoughts.private.setCoreStatus, {
        userId: ownerId,
        id: otherMemoryId,
        isCore: true,
      }),
    ).rejects.toThrow("Current memory not found");
    await expect(
      t.mutation(internal.models.thoughts.private.transitionMemory, {
        userId: ownerId,
        content: "Invalid cross-account replacement",
        embedding,
        metadata,
        previousIds: [ownerMemoryId, otherMemoryId],
        previousStatus: "superseded",
        reason: "Must not cross account boundaries",
        transitionedAt: Date.now(),
      }),
    ).rejects.toThrow("Previous memory is unavailable");

    const thoughts = await t.run((ctx) => ctx.db.query("thoughts").collect());
    expect(thoughts).toHaveLength(2);
    expect(
      thoughts.find((memory) => memory._id === ownerMemoryId)?.isCore,
    ).toBe(true);
    expect(
      thoughts.find((memory) => memory._id === otherMemoryId)?.isCore,
    ).toBe(false);
    expect(thoughts.every((memory) => memory.supersededBy === undefined)).toBe(
      true,
    );
  });
});
