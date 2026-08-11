import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";

const metadata = {
  type: "reference" as const,
  topics: [],
  people: [],
  actionItems: [],
  summary: "s",
};

async function seed(
  t: ReturnType<typeof convexTest>,
  statuses: Array<"current" | "superseded" | "retracted" | undefined>,
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    for (const [i, memoryStatus] of statuses.entries()) {
      await ctx.db.insert("thoughts", {
        content: `memory ${i}`,
        embedding: Array(1536).fill(0),
        metadata,
        userId,
        ...(memoryStatus === undefined ? {} : { memoryStatus }),
      });
    }
    return userId;
  });
}

async function runToCompletion(
  t: ReturnType<typeof convexTest>,
  args: { dryRun?: boolean; batchSize?: number } = {},
) {
  let cursor: string | null = null;
  let patched = 0;
  let needingBackfill = 0;
  for (let i = 0; i < 50; i += 1) {
    const result: {
      needingBackfill: number;
      patched: number;
      isDone: boolean;
      cursor: string | null;
    } = await t.mutation(
      internal.models.thoughts.migrations.backfillMemoryStatus,
      { ...args, ...(cursor ? { cursor } : {}) },
    );
    patched += result.patched;
    needingBackfill += result.needingBackfill;
    if (result.isDone) break;
    cursor = result.cursor;
  }
  return { patched, needingBackfill };
}

describe("memoryStatus backfill", () => {
  test("stamps legacy rows as current and leaves the rest alone", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [undefined, "superseded", undefined, "retracted", "current"]);

    const { patched } = await runToCompletion(t);
    expect(patched).toBe(2);

    const statuses = await t.run(async (ctx) => {
      const all = await ctx.db.query("thoughts").collect();
      return all.map((m) => m.memoryStatus).sort();
    });
    expect(statuses).toEqual([
      "current",
      "current",
      "current",
      "retracted",
      "superseded",
    ]);
  });

  test("is idempotent — a second run patches nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [undefined, undefined, "superseded"]);

    expect((await runToCompletion(t)).patched).toBe(2);
    expect((await runToCompletion(t)).patched).toBe(0);
  });

  test("dryRun counts without writing", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [undefined, undefined, "current"]);

    const dry = await runToCompletion(t, { dryRun: true });
    expect(dry.needingBackfill).toBe(2);
    expect(dry.patched).toBe(0);

    const stillMissing = await t.run(async (ctx) => {
      const all = await ctx.db.query("thoughts").collect();
      return all.filter((m) => m.memoryStatus === undefined).length;
    });
    expect(stillMissing).toBe(2);
  });

  test("pages through batches smaller than the table", async () => {
    const t = convexTest(schema, modules);
    await seed(t, Array(25).fill(undefined));

    expect((await runToCompletion(t, { batchSize: 4 })).patched).toBe(25);

    const missing = await t.run(async (ctx) => {
      const all = await ctx.db.query("thoughts").collect();
      return all.filter((m) => m.memoryStatus === undefined).length;
    });
    expect(missing).toBe(0);
  });

  test("audit reports zero once the backfill has run", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [undefined, "current", undefined]);

    const before = await t.mutation(
      internal.models.thoughts.migrations.countMissingMemoryStatus,
      {},
    );
    expect(before.missing).toBe(2);

    await runToCompletion(t);

    const after = await t.mutation(
      internal.models.thoughts.migrations.countMissingMemoryStatus,
      {},
    );
    expect(after.missing).toBe(0);
  });
});
