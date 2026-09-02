import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { ACCOUNT_COUNT_CAP } from "./private";

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

  test("pages list items by creation time like every other collection", async () => {
    // The regression this guards: list items used to be collected in one read
    // and returned as a single page, which ignored `after` and `pageSize` and
    // would exceed a query read limit on a large enough account.
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      const listId = await ctx.db.insert("lists", {
        userId,
        name: "groceries",
        pinned: false,
      });
      for (let index = 0; index < 7; index += 1) {
        await ctx.db.insert("listItems", {
          userId,
          listId,
          title: `item ${index}`,
          status: "open",
          position: index,
        });
      }
    });

    const first = await t.query(internal.models.export.private.collectionPage, {
      userId,
      collection: "listItems",
      pageSize: 5,
    });
    expect(first.rows).toHaveLength(5);
    expect(first.isDone).toBe(false);

    const second = await t.query(
      internal.models.export.private.collectionPage,
      {
        userId,
        collection: "listItems",
        pageSize: 5,
        after: first.cursor ?? undefined,
      },
    );
    expect(second.rows.map((row) => row.title)).toEqual(["item 5", "item 6"]);
    expect(second.isDone).toBe(true);
  });

  test("exports reports and insights, keeping the link between them", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const reportId = await t.run(async (ctx) => {
      const reportId = await ctx.db.insert("reports", {
        userId,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        sessionsAnalyzed: 3,
        totalPrompts: 10,
        totalToolCalls: 40,
        projectsActive: [],
        modelUsage: {},
      });
      await ctx.db.insert("insights", {
        userId,
        reportId,
        category: "productivity",
        observation: "observed",
        recommendation: "recommended",
        evidence: "seen",
        status: "new",
      });
      return reportId;
    });

    const reports = await t.query(
      internal.models.export.private.collectionPage,
      { userId, collection: "reports" },
    );
    expect(reports.rows.map((row) => row._id)).toEqual([reportId]);

    const insights = await t.query(
      internal.models.export.private.collectionPage,
      { userId, collection: "insights" },
    );
    expect(insights.rows).toHaveLength(1);
    // An importer remaps ids; it can only do that if the relationship survives.
    expect(insights.rows[0]?.reportId).toBe(reportId);
    expect(insights.rows[0]).not.toHaveProperty("userId");
  });

  test("counts distinguish total from current, one bounded page at a time", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "current"));
      await ctx.db.insert(
        "thoughts",
        thought(userId, "old", { memoryStatus: "superseded" }),
      );
      await ctx.db.insert("thoughts", thought(userId, "also current"));
    });

    const first = await t.query(internal.models.export.private.countPage, {
      userId,
      collection: "thoughts",
      pageSize: 2,
    });
    expect(first).toMatchObject({ total: 2, current: 1, isDone: false });

    const second = await t.query(internal.models.export.private.countPage, {
      userId,
      collection: "thoughts",
      pageSize: 2,
      after: first.cursor ?? undefined,
    });
    expect(second).toMatchObject({ total: 1, current: 1, isDone: true });
  });

  test("listing accounts discloses identifiers, not memory content", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Owner" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("thoughts", thought(userId, "a private memory"));
    });

    const page = await t.query(internal.models.export.private.listAccounts, {});
    expect(page.isDone).toBe(true);
    expect(page.accounts).toHaveLength(1);
    expect(page.accounts[0]).toMatchObject({
      userId,
      name: "Owner",
      thoughts: { count: 1, capped: false },
    });
    expect(JSON.stringify(page)).not.toContain("a private memory");
  });

  test("listing accounts never reads more than the cap per table", async () => {
    // The regression this guards: the listing used to collect every memory of
    // every user to count them, which fails outright once the deployment holds
    // more rows than one query may read.
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      for (let index = 0; index < ACCOUNT_COUNT_CAP + 5; index += 1) {
        await ctx.db.insert("thoughts", thought(userId, `memory ${index}`));
      }
    });

    const page = await t.query(internal.models.export.private.listAccounts, {});
    expect(page.accounts[0]?.thoughts).toEqual({
      count: ACCOUNT_COUNT_CAP,
      capped: true,
    });
  });
});
