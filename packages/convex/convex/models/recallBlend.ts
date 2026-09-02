/**
 * The single blend policy behind `recall_context`.
 *
 * Two callers depend on it: the MCP tool that serves clients, and the
 * evaluation harness that scores what clients receive. Keeping one copy is the
 * point — a harness that orders results differently from the tool measures a
 * window nobody sees, and would miss exactly the leaks and disagreements it
 * exists to catch.
 *
 * Order is significant. Scoring is top-k, so the sequence returned here is the
 * sequence that gets evaluated.
 */

export type RecallBlendInput<Fact, Thought> = {
  coreFacts: readonly Fact[];
  relevantFacts: readonly Fact[];
  relevantThoughts: readonly Thought[];
  limit: number;
  factId: (fact: Fact) => string;
};

export type RecallBlend<Fact, Thought> = {
  coreFacts: Fact[];
  relevanceFacts: Fact[];
  relevanceThoughts: Thought[];
};

/**
 * Core slots available at a given result limit.
 *
 * Core is context the question did not ask for, so it takes one slot at the
 * default limit of five and gains one more for every further five requested:
 * `coreLimitFor(5) === 1`, `coreLimitFor(10) === 2`. It used to take three of
 * five, which sent the same core set on every call and left two slots for the
 * answer (docs/comparisons/gbrain-bakeoff.md, run 1).
 *
 * Below three results core takes nothing. A caller asking for one or two
 * memories wants the answer, and a window that small cannot spare a slot for
 * something the question did not ask for.
 *
 * Core slots are filled from core facts only. A narrative memory flagged
 * `isCore` competes on relevance like any other memory; it no longer rides
 * along on every question.
 */
export function coreLimitFor(limit: number): number {
  if (limit < 3) return 0;
  return Math.max(1, Math.floor(limit / 5));
}

/**
 * Relevance slots facts may fill when thoughts also matched: at most a third,
 * rounded down, so one fact at the default limit.
 *
 * This is a cap, not a floor. The former guarantee that facts get at least
 * half the relevance slots is deliberately absent until W1 (fact embeddings)
 * lands: fact search is keyword-only and cannot rank semantically, so on any
 * question the keyword index cannot serve, a guaranteed fact slot is a
 * guaranteed junk slot. One slot keeps exact fact recall on the questions the
 * index can serve — the top keyword hit is the rank worth trusting — and
 * bounds the cost on the questions it cannot.
 */
function factRelevanceCap(relevanceLimit: number): number {
  return Math.floor(relevanceLimit / 3);
}

export function blendRecallContext<Fact, Thought>({
  coreFacts,
  relevantFacts,
  relevantThoughts,
  limit,
  factId,
}: RecallBlendInput<Fact, Thought>): RecallBlend<Fact, Thought> {
  const selectedCoreFacts = coreFacts.slice(0, coreLimitFor(limit));
  const coreFactIds = new Set(selectedCoreFacts.map(factId));

  const relevanceLimit = Math.max(0, limit - selectedCoreFacts.length);
  // Thoughts that did not match leave their slots to facts, so an account
  // whose only matches are facts still fills the window.
  const factRelevanceLimit = Math.min(
    relevanceLimit,
    Math.max(
      factRelevanceCap(relevanceLimit),
      relevanceLimit - relevantThoughts.length,
    ),
  );

  const relevanceFacts = relevantFacts
    .filter((fact) => !coreFactIds.has(factId(fact)))
    .slice(0, factRelevanceLimit);
  const relevanceThoughts = relevantThoughts.slice(
    0,
    Math.max(0, relevanceLimit - relevanceFacts.length),
  );

  return {
    coreFacts: selectedCoreFacts,
    relevanceFacts,
    relevanceThoughts,
  };
}
