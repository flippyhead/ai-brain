import { describe, expect, test } from "vitest";

import { blendRecallContext, coreLimitFor, exactLimitFor } from "./recallBlend";

const fact = (id: string) => ({ id });
const thought = (id: string) => ({ _id: id });

/** Counts are exact, core, relevant facts, relevant thoughts. */
function blend(limit: number, counts: [number, number, number, number]) {
  const [ef, cf, rf, rt] = counts;
  return blendRecallContext({
    exactFacts: Array.from({ length: ef }, (_, i) => fact(`ef${i}`)),
    coreFacts: Array.from({ length: cf }, (_, i) => fact(`cf${i}`)),
    relevantFacts: Array.from({ length: rf }, (_, i) => fact(`rf${i}`)),
    relevantThoughts: Array.from({ length: rt }, (_, i) => thought(`rt${i}`)),
    limit,
    factId: (f) => f.id,
  });
}

const size = (result: ReturnType<typeof blend>) =>
  result.exactFacts.length +
  result.coreFacts.length +
  result.relevanceFacts.length +
  result.relevanceThoughts.length;

describe("core slots", () => {
  test("core takes at most one slot at any limit the tool accepts", () => {
    // recall_context caps limit at eight; the eval harness scores at ten.
    for (const limit of [3, 4, 5, 8, 10]) {
      expect(coreLimitFor(limit)).toBe(1);
    }
    expect(blend(8, [0, 5, 0, 0]).coreFacts.map((f) => f.id)).toEqual(["cf0"]);
  });

  test("core takes nothing from a window of one or two", () => {
    expect(coreLimitFor(1)).toBe(0);
    expect(coreLimitFor(2)).toBe(0);
    expect(coreLimitFor(3)).toBe(1);
    expect(blend(2, [0, 3, 0, 3]).coreFacts).toHaveLength(0);
  });

  test("caps core facts at the core limit however many the account holds", () => {
    const result = blend(5, [0, 5, 0, 0]);
    expect(result.coreFacts.map((f) => f.id)).toEqual(["cf0"]);
  });

  test("a core narrative memory only appears when it matched the question", () => {
    // There is no core-thought tier: the only way a thought enters the window
    // is through the relevance ranking, where it competes like any other.
    const result = blend(5, [0, 1, 0, 3]);
    expect(result.relevanceThoughts.map((t) => t._id)).toEqual([
      "rt0",
      "rt1",
      "rt2",
    ]);
    expect(Object.keys(result).sort()).toEqual([
      "coreFacts",
      "exactFacts",
      "relevanceFacts",
      "relevanceThoughts",
    ]);
  });
});

describe("exact slots", () => {
  test("exact takes at most half of the slots left after core", () => {
    expect(exactLimitFor(3)).toBe(1);
    expect(exactLimitFor(5)).toBe(2);
    expect(exactLimitFor(8)).toBe(3);
    expect(exactLimitFor(10)).toBe(Math.floor((10 - coreLimitFor(10)) / 2));
    for (const limit of [3, 5, 8, 10]) {
      expect(exactLimitFor(limit) * 2).toBeLessThanOrEqual(
        limit - coreLimitFor(limit),
      );
    }
  });

  test("a window of one has no exact slot; a window of two splits", () => {
    expect(exactLimitFor(1)).toBe(0);
    expect(exactLimitFor(2)).toBe(1);
    expect(blend(1, [3, 0, 0, 3]).exactFacts).toHaveLength(0);
    const two = blend(2, [3, 0, 0, 3]);
    expect(two.exactFacts).toHaveLength(1);
    expect(two.relevanceThoughts).toHaveLength(1);
  });

  test.each([
    // limit, exact, core, relevance
    [3, 1, 1, 1],
    [5, 2, 1, 2],
    [8, 3, 1, 4],
  ])(
    "at limit %i exact gets %i, core %i, relevance %i when every tier is full",
    (limit, exact, core, relevance) => {
      const result = blend(limit, [9, 9, 9, 9]);
      expect(result.exactFacts).toHaveLength(exact);
      expect(result.coreFacts).toHaveLength(core);
      expect(
        result.relevanceFacts.length + result.relevanceThoughts.length,
      ).toBe(relevance);
    },
  );

  test("at limit 10 relevance keeps at least half the non-core slots", () => {
    const result = blend(10, [9, 9, 9, 9]);
    expect(result.coreFacts).toHaveLength(coreLimitFor(10));
    const nonCore = 10 - coreLimitFor(10);
    expect(result.exactFacts).toHaveLength(Math.floor(nonCore / 2));
    expect(
      result.relevanceFacts.length + result.relevanceThoughts.length,
    ).toBeGreaterThanOrEqual(Math.ceil(nonCore / 2));
  });

  test("leaves its slots to relevance when the query names nothing", () => {
    // With no exact hits the blend is exactly the pre-exact policy.
    const result = blend(5, [0, 1, 5, 5]);
    expect(result.exactFacts).toHaveLength(0);
    expect(result.coreFacts).toHaveLength(1);
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["rf0"]);
    expect(result.relevanceThoughts).toHaveLength(3);
  });

  test("leaves unused exact slots to relevance", () => {
    const result = blend(5, [1, 1, 5, 5]);
    expect(result.exactFacts).toHaveLength(1);
    expect(result.coreFacts).toHaveLength(1);
    expect(result.relevanceFacts.length + result.relevanceThoughts.length).toBe(
      3,
    );
  });

  test("serves a core fact the query named once, as exact", () => {
    const shared = fact("shared");
    const result = blendRecallContext({
      exactFacts: [shared],
      coreFacts: [shared, fact("other-core")],
      relevantFacts: [shared, fact("other-relevant")],
      relevantThoughts: [] as Array<{ _id: string }>,
      limit: 5,
      factId: (f) => f.id,
    });
    expect(result.exactFacts.map((f) => f.id)).toEqual(["shared"]);
    expect(result.coreFacts.map((f) => f.id)).toEqual(["other-core"]);
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["other-relevant"]);
  });

  test("never repeats an exact fact in the relevance slots", () => {
    const named = fact("named");
    const result = blendRecallContext({
      exactFacts: [named],
      coreFacts: [],
      relevantFacts: [named, fact("ranked")],
      relevantThoughts: [thought("rt0")],
      limit: 5,
      factId: (f) => f.id,
    });
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["ranked"]);
  });
});

describe("relevance slots", () => {
  test("facts fill at most a third when thoughts also matched", () => {
    // Default limit: one core, four relevance, of which one may be a fact.
    const result = blend(5, [0, 1, 5, 5]);
    expect(result.coreFacts).toHaveLength(1);
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["rf0"]);
    expect(result.relevanceThoughts).toHaveLength(3);
  });

  test("gives facts no guaranteed slot in a window too small to share", () => {
    // Limit 3: one core, two relevance — both go to thoughts.
    const result = blend(3, [0, 1, 3, 3]);
    expect(result.relevanceFacts).toHaveLength(0);
    expect(result.relevanceThoughts).toHaveLength(2);
  });

  test("lets facts take the whole relevance budget when no thoughts match", () => {
    const result = blend(4, [0, 0, 9, 0]);
    expect(result.relevanceFacts).toHaveLength(4);
    expect(result.relevanceThoughts).toHaveLength(0);
  });

  test("lets facts fill the slots thoughts leave empty", () => {
    const result = blend(5, [0, 0, 9, 2]);
    expect(result.relevanceThoughts).toHaveLength(2);
    expect(result.relevanceFacts).toHaveLength(3);
  });

  test("never repeats a core fact in the relevance slots", () => {
    const shared = fact("shared");
    const result = blendRecallContext({
      exactFacts: [],
      coreFacts: [shared],
      relevantFacts: [shared, fact("other")],
      relevantThoughts: [] as Array<{ _id: string }>,
      limit: 5,
      factId: (f) => f.id,
    });
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["other"]);
  });

  test("never exceeds the requested limit", () => {
    for (const limit of [1, 2, 3, 5, 8, 10]) {
      for (const exact of [0, 1, 4]) {
        expect(size(blend(limit, [exact, 4, 4, 4]))).toBeLessThanOrEqual(limit);
      }
    }
  });

  test("fills the requested limit when the stores can", () => {
    for (const limit of [1, 2, 3, 5, 8, 10]) {
      for (const exact of [0, 1, 4]) {
        expect(size(blend(limit, [exact, 4, 9, 9]))).toBe(limit);
      }
    }
  });
});
