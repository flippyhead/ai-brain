export type EvaluationMemoryStatus = "current" | "superseded" | "retracted";

export type RetrievalEvaluationResult = {
  id: string;
  userId: string;
  memoryStatus: EvaluationMemoryStatus;
  content: string;
};

export type RetrievalEvaluationCase = {
  name: string;
  query: string;
  expectedUserId: string;
  expectedIds: string[];
  results: RetrievalEvaluationResult[];
  includeHistorical?: boolean;
  expectedExactStrings?: string[];
  /**
   * Strings that must NOT appear in the retrieved window. Catches two failures
   * a recall count cannot: another account's value reaching this account, and
   * the structured and narrative stores disagreeing on the same predicate.
   */
  forbiddenExactStrings?: string[];
  k?: number;
  minimumRecall?: number;
};

export type RetrievalEvaluation = {
  name: string;
  recallAtK: number;
  tenantLeakIds: string[];
  unexpectedHistoricalIds: string[];
  missingExactStrings: string[];
  presentForbiddenStrings: string[];
  passed: boolean;
};

/**
 * Score a recorded retrieval result without calling an embedding or language model.
 * This keeps memory quality and account-isolation gates deterministic in CI.
 */
export function evaluateRetrievalCase(
  evaluationCase: RetrievalEvaluationCase,
): RetrievalEvaluation {
  const k = evaluationCase.k ?? 10;
  const expectedIds = new Set(evaluationCase.expectedIds);
  const topResults = evaluationCase.results.slice(0, k);
  const recalledIds = new Set(
    topResults
      .filter((result) => result.userId === evaluationCase.expectedUserId)
      .map((result) => result.id),
  );
  const recalledCount = [...expectedIds].filter((id) =>
    recalledIds.has(id),
  ).length;
  const recallAtK =
    expectedIds.size === 0 ? 1 : recalledCount / expectedIds.size;
  const tenantLeakIds = evaluationCase.results
    .filter((result) => result.userId !== evaluationCase.expectedUserId)
    .map((result) => result.id);
  // A superseded memory is a legitimate answer to an explicitly historical
  // question. A retracted memory was never true, so presenting it as prior
  // history is wrong in either mode.
  const unexpectedHistoricalIds = evaluationCase.results
    .filter((result) =>
      result.memoryStatus === "retracted"
        ? true
        : !evaluationCase.includeHistorical &&
          result.memoryStatus !== "current",
    )
    .map((result) => result.id);
  const retrievedContent = topResults
    .filter((result) => result.userId === evaluationCase.expectedUserId)
    .map((result) => result.content)
    .join("\n");
  const missingExactStrings = (
    evaluationCase.expectedExactStrings ?? []
  ).filter((value) => !retrievedContent.includes(value));
  const presentForbiddenStrings = (
    evaluationCase.forbiddenExactStrings ?? []
  ).filter((value) => retrievedContent.includes(value));
  const minimumRecall = evaluationCase.minimumRecall ?? 1;

  return {
    name: evaluationCase.name,
    recallAtK,
    tenantLeakIds,
    unexpectedHistoricalIds,
    missingExactStrings,
    presentForbiddenStrings,
    passed:
      recallAtK >= minimumRecall &&
      tenantLeakIds.length === 0 &&
      unexpectedHistoricalIds.length === 0 &&
      missingExactStrings.length === 0 &&
      presentForbiddenStrings.length === 0,
  };
}

/** Reference RRF scorer for comparing recorded hybrid-search rankings in evals. */
export function reciprocalRankFusion(
  rankedLists: string[][],
  k = 60,
): Array<{ id: string; score: number }> {
  if (!Number.isFinite(k) || k <= 0) {
    throw new Error("RRF k must be a positive finite number");
  }

  const scores = new Map<string, number>();
  for (const rankedList of rankedLists) {
    const seen = new Set<string>();
    rankedList.forEach((id, rank) => {
      if (seen.has(id)) return;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score);
}
