import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";

import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";

const issuer = "https://brain.example.test";
const embedding = Array.from({ length: 1536 }, () => 0);
const metadata = {
  type: "reference" as const,
  topics: ["credentials"],
  people: [],
  actionItems: [],
  summary: "Content that should never have been stored",
};

describe("forgetting a memory", () => {
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

  async function seed() {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const insert = (
      userId: Id<"users">,
      content: string,
      overrides: Record<string, unknown> = {},
    ) =>
      t.run((ctx) =>
        ctx.db.insert("thoughts", {
          userId,
          content,
          embedding,
          metadata,
          memoryStatus: "current",
          ...overrides,
        }),
      );
    return {
      t,
      ownerId,
      otherId,
      insert,
      owner: t.withIdentity({ issuer, subject: ownerId }),
      other: t.withIdentity({ issuer, subject: otherId }),
    };
  }

  test("deletes the row outright and echoes the reason without storing it", async () => {
    const { t, ownerId, insert, owner } = await seed();
    const thoughtId = await insert(ownerId, "API key: sk-live-not-real");

    const result = await owner.mutation(
      api.models.thoughts.mcpMutations.forgetThought,
      { thoughtId, reason: "  Mis-captured credential  " },
    );

    expect(result).toEqual({
      thoughtId,
      reason: "Mis-captured credential",
      detachedPredecessors: [],
      detachedSuccessor: undefined,
    });
    // Retraction keeps a row so it can be undone; forgetting leaves nothing.
    expect(await t.run((ctx) => ctx.db.get(thoughtId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("thoughts").collect())).toEqual(
      [],
    );
  });

  test("repairs both directions of the supersession chain", async () => {
    const { t, ownerId, insert, owner } = await seed();
    // predecessor -> forgotten -> successor, where the successor also
    // supersedes a sibling that must survive the repair untouched.
    const predecessorId = await insert(ownerId, "was true once", {
      memoryStatus: "superseded",
    });
    const retractedId = await insert(ownerId, "never true", {
      memoryStatus: "retracted",
    });
    const forgottenId = await insert(ownerId, "should never have existed", {
      memoryStatus: "superseded",
      supersedes: [predecessorId, retractedId],
    });
    const siblingId = await insert(ownerId, "another retired memory", {
      memoryStatus: "superseded",
    });
    const successorId = await insert(ownerId, "the current state", {
      supersedes: [forgottenId, siblingId],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(predecessorId, { supersededBy: forgottenId });
      await ctx.db.patch(retractedId, { supersededBy: forgottenId });
      await ctx.db.patch(forgottenId, { supersededBy: successorId });
      await ctx.db.patch(siblingId, { supersededBy: successorId });
    });

    const result = await owner.mutation(
      api.models.thoughts.mcpMutations.forgetThought,
      { thoughtId: forgottenId, reason: "Third party's private detail" },
    );

    expect(result.detachedPredecessors.sort()).toEqual(
      [predecessorId, retractedId].sort(),
    );
    expect(result.detachedSuccessor).toBe(successorId);

    const [predecessor, retracted, successor, sibling] = await t.run(
      async (ctx) => [
        await ctx.db.get(predecessorId),
        await ctx.db.get(retractedId),
        await ctx.db.get(successorId),
        await ctx.db.get(siblingId),
      ],
    );
    // Predecessors lose the dangling pointer but are not revived: forgetting
    // the successor does not make the earlier memory true again, and a
    // retracted one was never true regardless.
    expect(predecessor).toMatchObject({ memoryStatus: "superseded" });
    expect(predecessor?.supersededBy).toBeUndefined();
    expect(retracted).toMatchObject({ memoryStatus: "retracted" });
    expect(retracted?.supersededBy).toBeUndefined();
    // The successor keeps its other link.
    expect(successor?.supersedes).toEqual([siblingId]);
    expect(sibling).toMatchObject({
      memoryStatus: "superseded",
      supersededBy: successorId,
    });
    expect(await t.run((ctx) => ctx.db.get(forgottenId))).toBeNull();
  });

  test("removes an emptied supersedes list rather than leaving []", async () => {
    const { t, ownerId, insert, owner } = await seed();
    const forgottenId = await insert(ownerId, "only predecessor", {
      memoryStatus: "superseded",
    });
    const successorId = await insert(ownerId, "current", {
      supersedes: [forgottenId],
    });
    await t.run((ctx) =>
      ctx.db.patch(forgottenId, { supersededBy: successorId }),
    );

    await owner.mutation(api.models.thoughts.mcpMutations.forgetThought, {
      thoughtId: forgottenId,
      reason: "Never should have been stored",
    });

    const successor = await t.run((ctx) => ctx.db.get(successorId));
    expect(successor?.supersedes).toBeUndefined();
    expect(successor?.memoryStatus).toBe("current");
  });

  test("refuses another account's memory and leaves it untouched", async () => {
    const { t, ownerId, insert, other } = await seed();
    const thoughtId = await insert(ownerId, "not yours to erase");
    const before = await t.run((ctx) => ctx.db.get(thoughtId));

    await expect(
      other.mutation(api.models.thoughts.mcpMutations.forgetThought, {
        thoughtId,
        reason: "Trying to delete across accounts",
      }),
    ).rejects.toThrow("Memory not found");

    expect(await t.run((ctx) => ctx.db.get(thoughtId))).toEqual(before);
  });

  test("reports not found for an id that was already forgotten", async () => {
    const { t, ownerId, insert, owner } = await seed();
    const thoughtId = await insert(ownerId, "gone soon");

    await owner.mutation(api.models.thoughts.mcpMutations.forgetThought, {
      thoughtId,
      reason: "First call",
    });
    await expect(
      owner.mutation(api.models.thoughts.mcpMutations.forgetThought, {
        thoughtId,
        reason: "Second call",
      }),
    ).rejects.toThrow("Memory not found");
    expect(await t.run((ctx) => ctx.db.query("thoughts").collect())).toEqual(
      [],
    );
  });

  test("requires a reason and deletes nothing without one", async () => {
    const { t, ownerId, insert, owner } = await seed();
    const thoughtId = await insert(ownerId, "needs a reason");

    for (const reason of ["", "   ", "x".repeat(501)]) {
      await expect(
        owner.mutation(api.models.thoughts.mcpMutations.forgetThought, {
          thoughtId,
          reason,
        }),
      ).rejects.toThrow("requires a reason");
    }
    expect(await t.run((ctx) => ctx.db.get(thoughtId))).not.toBeNull();
  });
});
