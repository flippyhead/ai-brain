import { describe, expect, test } from "vitest";

import { blendRecallContext } from "../recallBlend";
import {
  evaluateRetrievalCase,
  reciprocalRankFusion,
  type RetrievalEvaluationResult,
} from "./memoryEval";
import { liveRecallCorpus } from "./memoryEval.corpus";
import {
  deterministicRetrievalFixtures,
  recordedBakeoffRankings,
  recordedExactEntityRankings,
  type RecordedRecallRanking,
} from "./memoryEval.fixtures";

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

describe("blend policy on the bake-off shapes", () => {
  const account = (label: string) => {
    const found = liveRecallCorpus.find((entry) => entry.label === label);
    if (!found) throw new Error(`No corpus account "${label}"`);
    return found;
  };

  const rowsFor = (
    label: string,
    keys: string[],
  ): RetrievalEvaluationResult[] => {
    const { memories, facts = [] } = account(label);
    return keys.map((key) => {
      const memory = memories.find((entry) => entry.key === key);
      if (memory) {
        const superseded = memories.some((entry) => entry.supersedes === key);
        const retracted = memories.some((entry) => entry.retracts === key);
        return {
          id: key,
          userId: label,
          memoryStatus: retracted
            ? "retracted"
            : superseded
              ? "superseded"
              : "current",
          content: memory.content,
        };
      }
      const fact = facts.find((entry) => entry.key === key);
      if (!fact) throw new Error(`No corpus memory or fact "${key}"`);
      const corrected = facts.some((entry) => entry.corrects === key);
      return {
        id: key,
        userId: label,
        memoryStatus: corrected ? "retracted" : "current",
        content: `${fact.subjectName} — ${fact.predicate}: ${fact.value}.`,
      };
    });
  };

  /** Assemble the window a client receives, in the order it receives it. */
  const windowAt = (
    ranking: RecordedRecallRanking,
    limit: number,
    { withExactTier = true } = {},
  ) => {
    const blend = blendRecallContext({
      exactFacts: withExactTier
        ? rowsFor(ranking.account, ranking.exactFactKeys)
        : [],
      coreFacts: rowsFor(ranking.account, ranking.coreFactKeys),
      relevantFacts: rowsFor(ranking.account, ranking.relevantFactKeys),
      relevantThoughts: rowsFor(ranking.account, ranking.relevantThoughtKeys),
      limit,
      factId: (row) => row.id,
    });
    return [
      ...blend.exactFacts,
      ...blend.coreFacts,
      ...blend.relevanceFacts,
      ...blend.relevanceThoughts,
    ];
  };

  const evaluateAtFive = (
    ranking: RecordedRecallRanking,
    options?: { withExactTier?: boolean },
  ) => {
    const query = account(ranking.account).queries.find(
      (entry) => entry.name === ranking.queryName,
    );
    if (!query) throw new Error(`No corpus query "${ranking.queryName}"`);
    return evaluateRetrievalCase({
      name: ranking.queryName,
      query: query.query,
      expectedUserId: ranking.account,
      expectedIds: query.expectedKeys,
      includeHistorical: query.includeHistorical,
      expectedExactStrings: query.expectedExactStrings,
      forbiddenExactStrings: query.forbiddenExactStrings,
      results: windowAt(ranking, 5, options),
      k: 5,
    });
  };

  test.each([...recordedBakeoffRankings, ...recordedExactEntityRankings])(
    "$queryName is answered at the default limit",
    (ranking) => {
      expect(evaluateAtFive(ranking)).toMatchObject({
        recallAtK: 1,
        tenantLeakIds: [],
        unexpectedHistoricalIds: [],
        missingExactStrings: [],
        presentForbiddenStrings: [],
        passed: true,
      });
    },
  );

  test.each(recordedExactEntityRankings)(
    "$queryName is lost without the exact tier",
    (ranking) => {
      // The name alone cannot rank the subject's facts against each other,
      // and the one relevance slot facts get at this limit goes to the wrong
      // one. This is the shape the exact tier exists for.
      expect(evaluateAtFive(ranking, { withExactTier: false }).recallAtK).toBe(
        0,
      );
    },
  );
});
