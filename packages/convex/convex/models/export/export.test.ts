import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";

const embedding = Array.from({ length: 1536 }, () => 0.1);

function thought(
  userId: Id<"users">,
  content: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    userId,
    content,
    embedding,
    metadata: {
      type: "reference" as const,
      topics: [],
      people: [],
      actionItems: [],
      summary: content,
    },
    ...overrides,
  };
}

describe("account export", () => {
  test("returns every current memory and never the embedding", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "first"));
      await ctx.db.insert("thoughts", thought(userId, "second"));
    });

    const page = await t.query(internal.models.export.private.collectionPage, {
      userId,
      collection: "thoughts",
    });

    expect(page.isDone).toBe(true);
    expect(page.rows.map((row) => row.content)).toEqual(["first", "second"]);
    // The archive carries the content the embedding was derived from, so
    // shipping 1536 floats per memory would multiply its size to say nothing new.
    expect(page.rows.every((row) => !("embedding" in row))).toBe(true);
    // An export belongs to one account; repeating the id invites a re-import
    // into the wrong one.
    expect(page.rows.every((row) => !("userId" in row))).toBe(true);
  });

  test("excludes superseded and retracted memories unless asked", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "current one"));
      await ctx.db.insert(
        "thoughts",
        thought(userId, "old one", { memoryStatus: "superseded" }),
      );
      await ctx.db.insert(
        "thoughts",
        thought(userId, "wrong one", { memoryStatus: "retracted" }),
      );
    });

    const current = await t.query(
      internal.models.export.private.collectionPage,
      { userId, collection: "thoughts" },
    );
    expect(current.rows.map((row) => row.content)).toEqual(["current one"]);

    const all = await t.query(internal.models.export.private.collectionPage, {
      userId,
      collection: "thoughts",
      includeHistorical: true,
    });
    expect(all.rows).toHaveLength(3);
  });

  test("pages forward without skipping or repeating a row", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("thoughts", thought(userId, `memory ${index}`));
      }
    });

    const seen: unknown[] = [];
    let after: number | undefined;
    let guard = 0;
    for (;;) {
      const page: {
        rows: Record<string, unknown>[];
        cursor: number | null;
        isDone: boolean;
      } = await t.query(internal.models.export.private.collectionPage, {
        userId,
        collection: "thoughts",
        pageSize: 10,
        after,
      });
      seen.push(...page.rows.map((row) => row.content));
      if (page.isDone) break;
      after = page.cursor ?? undefined;
      guard += 1;
      if (guard > 10) throw new Error("export paging did not terminate");
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  test("keeps paging when a whole page filters out", async () => {
    // The regression this guards: a caller that stops on an empty page, or a
    // cursor taken from the last row RETURNED rather than the last row READ,
    // silently truncates the export at the first run of superseded memories.
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert(
          "thoughts",
          thought(userId, `old ${index}`, { memoryStatus: "superseded" }),
        );
      }
      await ctx.db.insert("thoughts", thought(userId, "the survivor"));
    });

    const first = await t.query(internal.models.export.private.collectionPage, {
      userId,
      collection: "thoughts",
      pageSize: 5,
    });
    expect(first.rows).toHaveLength(0);
    expect(first.isDone).toBe(false);
    expect(first.scanned).toBe(5);
    expect(first.cursor).not.toBeNull();

    const second = await t.query(
      internal.models.export.private.collectionPage,
      {
        userId,
        collection: "thoughts",
        pageSize: 5,
        after: first.cursor ?? undefined,
      },
    );
    expect(second.rows.map((row) => row.content)).toEqual(["the survivor"]);
    expect(second.isDone).toBe(true);
  });

  test("never returns another account's rows", async () => {
    const t = convexTest(schema, modules);
    const { mine, theirs } = await t.run(async (ctx) => ({
      mine: await ctx.db.insert("users", {}),
      theirs: await ctx.db.insert("users", {}),
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(mine, "mine"));
      await ctx.db.insert("thoughts", thought(theirs, "theirs"));
    });

    const page = await t.query(internal.models.export.private.collectionPage, {
      userId: mine,
      collection: "thoughts",
    });
    expect(page.rows.map((row) => row.content)).toEqual(["mine"]);
  });

  test("counts distinguish total from current", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "current"));
      await ctx.db.insert(
        "thoughts",
        thought(userId, "old", { memoryStatus: "superseded" }),
      );
    });

    const counts = await t.query(internal.models.export.private.counts, {
      userId,
    });
    expect(counts.thoughts).toEqual({ total: 2, current: 1 });
  });

  test("listing accounts discloses identifiers, not memory content", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Owner" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "a private memory"));
    });

    const accounts = await t.query(
      internal.models.export.private.listAccounts,
      {},
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ userId, name: "Owner", thoughts: 1 });
    expect(JSON.stringify(accounts)).not.toContain("a private memory");
  });
});
