import { describe, expect, test } from "vitest";

import { blendRecallContext, coreLimitFor } from "./recallBlend";

const fact = (id: string) => ({ id });
const thought = (id: string) => ({ _id: id });

function blend(limit: number, counts: [number, number, number, number]) {
  const [cf, ct, rf, rt] = counts;
  return blendRecallContext({
    coreFacts: Array.from({ length: cf }, (_, i) => fact(`cf${i}`)),
    coreThoughts: Array.from({ length: ct }, (_, i) => thought(`ct${i}`)),
    relevantFacts: Array.from({ length: rf }, (_, i) => fact(`rf${i}`)),
    relevantThoughts: Array.from({ length: rt }, (_, i) => thought(`rt${i}`)),
    limit,
    factId: (f) => f.id,
    coreThoughtId: (t) => t._id,
    relevantThoughtId: (t) => t._id,
  });
}

describe("recall context blend", () => {
  test("caps core facts at two so core memories keep a slot", () => {
    const result = blend(5, [5, 5, 0, 0]);
    expect(result.coreFacts).toHaveLength(2);
    expect(result.coreThoughts).toHaveLength(coreLimitFor(5) - 2);
  });

  test("gives facts at least one relevance slot and at most half", () => {
    const result = blend(5, [0, 0, 5, 5]);
    expect(result.relevanceFacts.length).toBeGreaterThanOrEqual(1);
    expect(result.relevanceFacts.length).toBeLessThanOrEqual(
      Math.ceil(5 / 2),
    );
    expect(
      result.relevanceFacts.length + result.relevanceThoughts.length,
    ).toBe(5);
  });

  test("lets facts take the whole relevance budget when no thoughts match", () => {
    const result = blend(4, [0, 0, 9, 0]);
    expect(result.relevanceFacts).toHaveLength(4);
    expect(result.relevanceThoughts).toHaveLength(0);
  });

  test("never repeats a core item in the relevance slots", () => {
    const shared = fact("shared");
    const result = blendRecallContext({
      coreFacts: [shared],
      coreThoughts: [],
      relevantFacts: [shared, fact("other")],
      relevantThoughts: [],
      limit: 5,
      factId: (f) => f.id,
      coreThoughtId: (t: { _id: string }) => t._id,
      relevantThoughtId: (t: { _id: string }) => t._id,
    });
    expect(result.relevanceFacts.map((f) => f.id)).toEqual(["other"]);
  });

  test("never exceeds the requested limit", () => {
    for (const limit of [1, 2, 3, 5, 10]) {
      const r = blend(limit, [4, 4, 4, 4]);
      const total =
        r.coreFacts.length +
        r.coreThoughts.length +
        r.relevanceFacts.length +
        r.relevanceThoughts.length;
      expect(total).toBeLessThanOrEqual(limit);
    }
  });
});
