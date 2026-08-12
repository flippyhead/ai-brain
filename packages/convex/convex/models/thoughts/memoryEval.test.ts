import { describe, expect, test } from "vitest";

import { evaluateRetrievalCase, reciprocalRankFusion } from "./memoryEval";
import { deterministicRetrievalFixtures } from "./memoryEval.fixtures";

describe("deterministic memory retrieval evaluations", () => {
  test.each(deterministicRetrievalFixtures)("$name", (fixture) => {
    expect(evaluateRetrievalCase(fixture)).toMatchObject({
      recallAtK: 1,
      tenantLeakIds: [],
      unexpectedHistoricalIds: [],
      missingExactStrings: [],
      presentForbiddenStrings: [],
      passed: true,
    });
  });

  test("fails closed on account leaks, stale current results, and normalized identifiers", () => {
    const evaluation = evaluateRetrievalCase({
      name: "bad retrieval",
      query: "What version is Atlas Memory on?",
      expectedUserId: "avery",
      expectedIds: ["expected"],
      expectedExactStrings: ["v2.7.1"],
      results: [
        {
          id: "stale",
          userId: "avery",
          memoryStatus: "superseded",
          content: "Version 2.7.1",
        },
        {
          id: "other-account",
          userId: "rowan",
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
      presentForbiddenStrings: [],
      passed: false,
    });
  });

  test("rejects retracted memories even for historical queries", () => {
    const evaluation = evaluateRetrievalCase({
      name: "retracted surfaced as history",
      query: "What has Avery's blood type been recorded as?",
      expectedUserId: "avery",
      expectedIds: ["corrected"],
      includeHistorical: true,
      results: [
        {
          id: "corrected",
          userId: "avery",
          memoryStatus: "current",
          content: "Avery's blood type is A negative.",
        },
        {
          id: "never-true",
          userId: "avery",
          memoryStatus: "retracted",
          content: "Avery's blood type is O negative.",
        },
        {
          id: "formerly-true",
          userId: "avery",
          memoryStatus: "superseded",
          content: "Avery's clinic is Bayside Family Medicine.",
        },
      ],
    });

    expect(evaluation.unexpectedHistoricalIds).toEqual(["never-true"]);
    expect(evaluation.passed).toBe(false);
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
        expectedUserId: "avery",
        expectedIds: ["first"],
        expectedExactStrings: ["v2.7.1"],
        k: 1,
        results: [
          {
            id: "first",
            userId: "avery",
            memoryStatus: "current",
            content: "Atlas Memory release",
          },
          {
            id: "below-cutoff",
            userId: "avery",
            memoryStatus: "current",
            content: "Atlas Memory v2.7.1",
          },
        ],
      }).passed,
    ).toBe(false);
  });
});

describe("cross-store disagreement", () => {
  test("fails when a forbidden value reaches the retrieved window", () => {
    // The structured and narrative stores must not answer the same predicate
    // differently, and one account's value must never appear for another.
    const evaluation = evaluateRetrievalCase({
      name: "stores disagree on the same predicate",
      query: "Where does Zevin go to school now?",
      expectedUserId: "avery",
      expectedIds: ["fact-school"],
      forbiddenExactStrings: ["Brightwater"],
      results: [
        {
          id: "fact-school",
          userId: "avery",
          memoryStatus: "current",
          content: "Zevin — school: Redwood Academy.",
        },
        {
          id: "stale-narrative",
          userId: "avery",
          memoryStatus: "current",
          content: "Zevin attends Brightwater School.",
        },
      ],
    });

    expect(evaluation.recallAtK).toBe(1);
    expect(evaluation.presentForbiddenStrings).toEqual(["Brightwater"]);
    expect(evaluation.passed).toBe(false);
  });
});
