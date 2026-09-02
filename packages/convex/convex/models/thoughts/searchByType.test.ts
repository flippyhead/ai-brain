import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";

const embedding = Array.from({ length: 1536 }, () => 0);

function metadata(type: "procedural" | "reference", summary: string) {
  return { type, topics: ["releases"], people: [], actionItems: [], summary };
}

describe("search by thought type", () => {
  test("filters text search and the timeline to procedural memories", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const [proceduralId, referenceId] = await t.run(async (ctx) => [
      await ctx.db.insert("thoughts", {
        userId,
        content:
          "To cut a release: run the eval, bump the version, then deploy.",
        embedding,
        metadata: metadata("procedural", "How a release is cut"),
      }),
      await ctx.db.insert("thoughts", {
        userId,
        content: "The release train ships on the first Tuesday of the month.",
        embedding,
        metadata: metadata("reference", "Release cadence"),
      }),
    ]);

    // `by_content` filters on metadata.type, so the new value must be accepted
    // by the `thoughtType` validator on the query as well as by the schema.
    const procedural = await t.query(
      internal.models.thoughts.private.searchByText,
      {
        userId,
        query: "release",
        type: "procedural",
        activeAt: Date.now(),
      },
    );
    expect(procedural.map((hit) => hit._id)).toEqual([proceduralId]);

    const unfiltered = await t.query(
      internal.models.thoughts.private.searchByText,
      { userId, query: "release", activeAt: Date.now() },
    );
    expect(unfiltered.map((hit) => hit._id).sort()).toEqual(
      [proceduralId, referenceId].sort(),
    );

    // `by_userId_and_type` backs the timeline's type filter.
    const timeline = await t.query(
      internal.models.thoughts.private.listAroundTime,
      {
        userId,
        aroundMs: Date.now() + 60_000,
        before: 10,
        after: 10,
        type: "procedural",
      },
    );
    expect(timeline.map((hit) => hit._id)).toEqual([proceduralId]);
  });
});
