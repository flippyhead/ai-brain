import { describe, expect, test } from "vitest";

import { evaluateRetrievalCase, reciprocalRankFusion } from "./memory-eval";
import { deterministicRetrievalFixtures } from "./memory-eval.fixtures";

describe("deterministic memory retrieval evaluations", () => {
  test.each(deterministicRetrievalFixtures)("$name", (fixture) => {
    expect(evaluateRetrievalCase(fixture)).toMatchObject({
      recallAtK: 1,
      tenantLeakIds: [],
      unexpectedHistoricalIds: [],
      missingExactStrings: [],
      passed: true,
    });
  });

  test("fails closed on account leaks, stale current results, and normalized identifiers", () => {
    const evaluation = evaluateRetrievalCase({
      name: "bad retrieval",
      query: "What version is Atlas Memory on?",
      expectedUserId: "jordan",
      expectedIds: ["expected"],
      expectedExactStrings: ["v2.7.1"],
      results: [
        {
          id: "stale",
          userId: "jordan",
          memoryStatus: "superseded",
          content: "Version 2.7.1",
        },
        {
          id: "other-account",
          userId: "noam",
          memoryStatus: "current",
          content: "Private memory",
        },
      ],
    });

    expect(evaluation).toEqual({
      name: "bad retrieval",
      recallAtK: 0,
      tenantLeakIds: ["other-account"],
      unexpectedHistoricalIds: ["stale"],
      missingExactStrings: ["v2.7.1"],
      passed: false,
    });
  });

  test("RRF rewards agreement between semantic and keyword rankings", () => {
    const ranking = reciprocalRankFusion([
      ["semantic-only", "shared", "tail"],
      ["keyword-only", "shared", "tail"],
    ]);

    expect(ranking.map((result) => result.id)).toEqual([
      "shared",
      "tail",
      "semantic-only",
      "keyword-only",
    ]);
    expect(ranking[0]!.score).toBeGreaterThan(ranking[2]!.score);
  });

  test("RRF ignores duplicate IDs within one source ranking", () => {
    expect(reciprocalRankFusion([["same", "same"]])).toHaveLength(1);
    expect(() => reciprocalRankFusion([], 0)).toThrow(
      "RRF k must be a positive finite number",
    );
  });

  test("exact-string checks are limited to the evaluated top-k window", () => {
    expect(
      evaluateRetrievalCase({
        name: "exact term below cutoff",
        query: "Which release?",
        expectedUserId: "jordan",
        expectedIds: ["first"],
        expectedExactStrings: ["v2.7.1"],
        k: 1,
        results: [
          {
            id: "first",
            userId: "jordan",
            memoryStatus: "current",
            content: "Atlas Memory release",
          },
          {
            id: "below-cutoff",
            userId: "jordan",
            memoryStatus: "current",
            content: "Atlas Memory v2.7.1",
          },
        ],
      }).passed,
    ).toBe(false);
  });
});
