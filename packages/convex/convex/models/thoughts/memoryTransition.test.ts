import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { _listByUser } from "./model";

const embedding = Array.from({ length: 1536 }, () => 0);
const metadata = {
  type: "person_note" as const,
  topics: ["school"],
  people: ["Zevin"],
  actionItems: [],
  summary: "Zevin's school",
};
const lakesideStart = Date.UTC(2023, 7, 21);
const redwoodStart = Date.UTC(2026, 7, 17);

describe("temporal memory transitions", () => {
  test("atomically preserves and links a superseded memory", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const previousId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId,
        content: "Zevin attends Lakeside School.",
        embedding,
        metadata,
        validFrom: lakesideStart,
      }),
    );
    const transitionedAt = Date.now();

    const currentId = await t.mutation(
      internal.models.thoughts.private.transitionMemory,
      {
        userId,
        content:
          "Zevin currently attends Redwood Academy. He previously attended Lakeside School.",
        embedding,
        metadata,
        previousIds: [previousId],
        previousStatus: "superseded",
        reason: "Zevin changed schools",
        transitionedAt,
        validFrom: redwoodStart,
      },
    );

    const [previous, current] = await t.run(async (ctx) => [
      await ctx.db.get(previousId),
      await ctx.db.get(currentId),
    ]);
    expect(previous).toMatchObject({
      content: "Zevin attends Lakeside School.",
      memoryStatus: "superseded",
      supersededAt: transitionedAt,
      supersededBy: currentId,
      changeReason: "Zevin changed schools",
      validFrom: lakesideStart,
      validTo: redwoodStart,
    });
    expect(current).toMatchObject({
      content:
        "Zevin currently attends Redwood Academy. He previously attended Lakeside School.",
      memoryStatus: "current",
      supersedes: [previousId],
      validFrom: redwoodStart,
    });

    const [currentMemories, fullHistory] = await t.run(async (ctx) => [
      await _listByUser(ctx, userId, 20),
      await _listByUser(ctx, userId, 20, true),
    ]);
    expect(currentMemories.map((memory) => memory._id)).toEqual([currentId]);
    expect(fullHistory.map((memory) => memory._id)).toEqual([
      currentId,
      previousId,
    ]);
  });

  test("does not invent an interval end when the new start is unknown", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const previousId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId,
        content: "Zevin attends Lakeside School.",
        embedding,
        metadata,
        validFrom: lakesideStart,
      }),
    );

    await t.mutation(internal.models.thoughts.private.transitionMemory, {
      userId,
      content:
        "Zevin currently attends Redwood Academy. He previously attended Lakeside School.",
      embedding,
      metadata,
      previousIds: [previousId],
      previousStatus: "superseded",
      reason: "Zevin changed schools, but the date is unknown",
      transitionedAt: Date.now(),
    });

    const previous = await t.run((ctx) => ctx.db.get(previousId));
    expect(previous).toMatchObject({
      memoryStatus: "superseded",
      validFrom: lakesideStart,
    });
    expect(previous?.validTo).toBeUndefined();
  });

  test("does not turn a retracted claim into a historical validity interval", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const inaccurateId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId,
        content: "Zevin attends Lakeside School.",
        embedding,
        metadata,
        validFrom: lakesideStart,
        validTo: redwoodStart,
      }),
    );

    const correctedId = await t.mutation(
      internal.models.thoughts.private.transitionMemory,
      {
        userId,
        content:
          "Correction: Zevin attends Redwood Academy; the Lakeside claim was inaccurate.",
        embedding,
        metadata,
        previousIds: [inaccurateId],
        previousStatus: "retracted",
        reason: "The earlier school was incorrect",
        transitionedAt: Date.now(),
        validFrom: redwoodStart,
      },
    );

    const [inaccurate, corrected] = await t.run(async (ctx) => [
      await ctx.db.get(inaccurateId),
      await ctx.db.get(correctedId),
    ]);
    expect(inaccurate).toMatchObject({ memoryStatus: "retracted" });
    expect(inaccurate?.validFrom).toBeUndefined();
    expect(inaccurate?.validTo).toBeUndefined();
    expect(corrected).toMatchObject({
      memoryStatus: "current",
      validFrom: redwoodStart,
    });
  });

  test("rejects an invalid new interval without partial writes", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const previousId = await t.run((ctx) =>
      ctx.db.insert("thoughts", {
        userId,
        content: "Previous memory",
        embedding,
        metadata,
      }),
    );

    await expect(
      t.mutation(internal.models.thoughts.private.transitionMemory, {
        userId,
        content: "Replacement memory",
        embedding,
        metadata,
        previousIds: [previousId],
        previousStatus: "superseded",
        reason: "Invalid interval",
        transitionedAt: Date.now(),
        validFrom: redwoodStart,
        validTo: lakesideStart,
      }),
    ).rejects.toThrow("Invalid memory validity interval");

    const memories = await t.run((ctx) => ctx.db.query("thoughts").collect());
    expect(memories).toHaveLength(1);
    expect(memories[0]?.memoryStatus).toBeUndefined();
  });

  test("rejects cross-account transitions without partial writes", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const [ownerMemoryId, otherMemoryId] = await t.run(async (ctx) => [
      await ctx.db.insert("thoughts", {
        userId: ownerId,
        content: "Owner memory",
        embedding,
        metadata,
      }),
      await ctx.db.insert("thoughts", {
        userId: otherId,
        content: "Other memory",
        embedding,
        metadata,
      }),
    ]);

    await expect(
      t.mutation(internal.models.thoughts.private.transitionMemory, {
        userId: ownerId,
        content: "Replacement memory",
        embedding,
        metadata,
        previousIds: [ownerMemoryId, otherMemoryId],
        previousStatus: "superseded",
        reason: "Invalid cross-account transition",
        transitionedAt: Date.now(),
      }),
    ).rejects.toThrow("Previous memory is unavailable");

    const memories = await t.run((ctx) => ctx.db.query("thoughts").collect());
    expect(memories).toHaveLength(2);
    expect(memories.every((memory) => memory.memoryStatus === undefined)).toBe(
      true,
    );
  });
});
