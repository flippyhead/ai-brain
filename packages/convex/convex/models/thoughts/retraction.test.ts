import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { _listByUser } from "./model";

const issuer = "https://brain.example.test";
const embedding = Array.from({ length: 1536 }, () => 0);
const metadata = {
  type: "decision" as const,
  topics: ["moderation"],
  people: [],
  actionItems: [],
  summary: "A memory that should not have been stored",
};

describe("caller-declared retraction", () => {
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
    const thoughtId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Junk that was never true",
        embedding,
        metadata,
        memoryStatus: "current",
      }),
    );
    return {
      t,
      ownerId,
      thoughtId,
      owner: t.withIdentity({ issuer, subject: ownerId }),
      other: t.withIdentity({ issuer, subject: otherId }),
    };
  }

  test("withholds a retracted memory from recall but keeps it fetchable by id", async () => {
    const { t, ownerId, thoughtId, owner } = await seed();

    await owner.mutation(api.models.thoughts.mcpMutations.retractThought, {
      thoughtId,
      reason: "Captured in error; this was never true",
    });

    // Browse and search share isMemoryRetrievable, which withholds a retracted
    // memory even when history is requested.
    for (const includeHistorical of [false, true]) {
      expect(
        await t.run((ctx) => _listByUser(ctx, ownerId, 20, includeHistorical)),
      ).toEqual([]);
    }

    // Fetch by id still resolves it. This is deliberate: it is the only way to
    // read a retracted memory back, and so the only way an undo is usable.
    const stored = await t.run((ctx) => ctx.db.get(thoughtId));
    expect(stored?.memoryStatus).toBe("retracted");
    expect(stored?.changeReason).toBe(
      "Captured in error; this was never true",
    );
  });

  test("keeps a retracted memory off the timeline while superseded history stays", async () => {
    const { t, ownerId, thoughtId, owner } = await seed();
    const supersededId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Was true once",
        embedding,
        metadata,
        memoryStatus: "superseded",
      }),
    );

    await owner.mutation(api.models.thoughts.mcpMutations.retractThought, {
      thoughtId,
      reason: "Never true",
    });

    // listAroundTime returns whole documents and is the one read path that does
    // not consult isMemoryRetrievable. Without a filter the retracted content
    // stays readable here after being hidden everywhere else.
    const rows = await t.run((ctx) =>
      ctx.runQuery(internal.models.thoughts.private.listAroundTime, {
        userId: ownerId,
        aroundMs: Date.now(),
        before: 50,
        after: 50,
      }),
    );
    const ids = rows.map((row) => row._id);
    expect(ids).toContain(supersededId);
    expect(ids).not.toContain(thoughtId);
  });

  test("restores a retraction and refuses one that has a replacement", async () => {
    const { t, ownerId, thoughtId, owner } = await seed();

    await owner.mutation(api.models.thoughts.mcpMutations.retractThought, {
      thoughtId,
      reason: "Never true",
    });
    await owner.mutation(api.models.thoughts.mcpMutations.restoreThought, {
      thoughtId,
    });

    const restored = await t.run((ctx) => ctx.db.get(thoughtId));
    expect(restored?.memoryStatus).toBe("current");
    expect(restored?.changeReason).toBeUndefined();
    expect(
      (await t.run((ctx) => _listByUser(ctx, ownerId, 20, false))).map(
        (row) => row._id,
      ),
    ).toEqual([thoughtId]);

    // A memory retracted by a replacement must stay retired: its successor is
    // current, so reviving it would put two contradicting memories in play.
    const replacedId = await t.run(async (ctx) => {
      const successor = await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "The correction",
        embedding,
        metadata,
        memoryStatus: "current",
      });
      return await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Retired by a replacement",
        embedding,
        metadata,
        memoryStatus: "retracted",
        supersededBy: successor,
      });
    });

    await expect(
      owner.mutation(api.models.thoughts.mcpMutations.restoreThought, {
        thoughtId: replacedId,
      }),
    ).rejects.toThrow("cannot be restored directly");
  });

  test("checks ownership and refuses to retract what is not current", async () => {
    const { t, ownerId, thoughtId, owner, other } = await seed();

    await expect(
      other.mutation(api.models.thoughts.mcpMutations.retractThought, {
        thoughtId,
        reason: "Not mine to retract",
      }),
    ).rejects.toThrow("Memory not found");

    await t.run((ctx) =>
      ctx.db.patch(thoughtId, { memoryStatus: "superseded" }),
    );
    await expect(
      owner.mutation(api.models.thoughts.mcpMutations.retractThought, {
        thoughtId,
        reason: "Already history",
      }),
    ).rejects.toThrow("Only a current memory can be retracted");
  });
});
