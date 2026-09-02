import { describe, expect, test } from "vitest";

import { blendRecallContext, coreLimitFor } from "./recallBlend";

const fact = (id: string) => ({ id });
const thought = (id: string) => ({ _id: id });

function blend(limit: number, counts: [number, number, number]) {
  const [cf, rf, rt] = counts;
  return blendRecallContext({
    coreFacts: Array.from({ length: cf }, (_, i) => fact(`cf${i}`)),
    relevantFacts: Array.from({ length: rf }, (_, i) => fact(`rf${i}`)),
    relevantThoughts: Array.from({ length: rt }, (_, i) => thought(`rt${i}`)),
    limit,
    factId: (f) => f.id,
  });
}

describe("core slots", () => {
  test("core takes at most one slot at any limit the tool accepts", () => {
    // recall_context caps limit at eight; the eval harness scores at ten.
    for (const limit of [3, 4, 5, 8, 10]) {
      expect(coreLimitFor(limit)).toBe(1);
    }
    expect(blend(8, [5, 0, 0]).coreFacts.map((f) => f.id)).toEqual(["cf0"]);
  });

  test("core takes nothing from a window of one or two", () => {
    expect(coreLimitFor(1)).toBe(0);
    expect(coreLimitFor(2)).toBe(0);
    expect(coreLimitFor(3)).toBe(1);
    expect(blend(2, [3, 0, 3]).coreFacts).toHaveLength(0);
  });

  test("caps core facts at the core limit however many the account holds", () => {
    const result = blend(5, [5, 0, 0]);
    expect(result.coreFacts.map((f) => f.id)).toEqual(["cf0"]);
  });

  test("a core narrative memory only appears when it matched the question", () => {
    // There is no core-thought tier: the only way a thought enters the window
    // is through the relevance ranking, where it competes like any other.
    const result = blend(5, [1, 0, 3]);
    expect(result.relevanceThoughts.map((t) => t._id)).toEqual([
      "rt0",
      "rt1",
      "rt2",
    ]);
    expect(Object.keys(result).sort()).toEqual([
      "coreFacts",
      "relevanceFacts",
      "relevanceThoughts",
    ]);
  });
});

describe("relevance slots", () => {
  test("facts fill at most a third when thoughts also matched", () => {
    // Default limit: one core, four relevance, of which one may be a fact.
    const result = blend(5, [1, 5, 5]);
    expect(result.coreFacts).toHaveLength(1);
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["rf0"]);
    expect(result.relevanceThoughts).toHaveLength(3);
  });

  test("gives facts no guaranteed slot in a window too small to share", () => {
    // Limit 3: one core, two relevance — both go to thoughts.
    const result = blend(3, [1, 3, 3]);
    expect(result.relevanceFacts).toHaveLength(0);
    expect(result.relevanceThoughts).toHaveLength(2);
  });

  test("lets facts take the whole relevance budget when no thoughts match", () => {
    const result = blend(4, [0, 9, 0]);
    expect(result.relevanceFacts).toHaveLength(4);
    expect(result.relevanceThoughts).toHaveLength(0);
  });

  test("lets facts fill the slots thoughts leave empty", () => {
    const result = blend(5, [0, 9, 2]);
    expect(result.relevanceThoughts).toHaveLength(2);
    expect(result.relevanceFacts).toHaveLength(3);
  });

  test("never repeats a core fact in the relevance slots", () => {
    const shared = fact("shared");
    const result = blendRecallContext({
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
      const r = blend(limit, [4, 4, 4]);
      const total =
        r.coreFacts.length +
        r.relevanceFacts.length +
        r.relevanceThoughts.length;
      expect(total).toBeLessThanOrEqual(limit);
    }
  });

  test("fills the requested limit when the stores can", () => {
    for (const limit of [1, 2, 3, 5, 8, 10]) {
      const r = blend(limit, [4, 9, 9]);
      expect(
        r.coreFacts.length +
          r.relevanceFacts.length +
          r.relevanceThoughts.length,
      ).toBe(limit);
    }
  });
});
