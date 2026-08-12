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

// Core and relevant thoughts arrive in different shapes — a hydrated core row
// and a search index row — so they are separate type parameters rather than
// forced into one.
export type RecallBlendInput<Fact, CoreThought, RelevantThought> = {
  coreFacts: readonly Fact[];
  coreThoughts: readonly CoreThought[];
  relevantFacts: readonly Fact[];
  relevantThoughts: readonly RelevantThought[];
  limit: number;
  factId: (fact: Fact) => string;
  coreThoughtId: (thought: CoreThought) => string;
  relevantThoughtId: (thought: RelevantThought) => string;
};

export type RecallBlend<Fact, CoreThought, RelevantThought> = {
  coreFacts: Fact[];
  coreThoughts: CoreThought[];
  relevanceFacts: Fact[];
  relevanceThoughts: RelevantThought[];
};

/** Core slots available at a given result limit. */
export function coreLimitFor(limit: number): number {
  return Math.min(3, limit);
}

export function blendRecallContext<Fact, CoreThought, RelevantThought>({
  coreFacts,
  coreThoughts,
  relevantFacts,
  relevantThoughts,
  limit,
  factId,
  coreThoughtId,
  relevantThoughtId,
}: RecallBlendInput<Fact, CoreThought, RelevantThought>): RecallBlend<
  Fact,
  CoreThought,
  RelevantThought
> {
  const coreLimit = coreLimitFor(limit);

  // Facts take at most two core slots so an account with many core facts cannot
  // crowd out every core memory.
  const selectedCoreFacts = coreFacts.slice(0, Math.min(2, coreLimit));
  const selectedCoreThoughts = coreThoughts.slice(
    0,
    Math.max(0, coreLimit - selectedCoreFacts.length),
  );

  const coreFactIds = new Set(selectedCoreFacts.map(factId));
  const coreThoughtIds = new Set(selectedCoreThoughts.map(coreThoughtId));

  const relevanceLimit = Math.max(
    0,
    limit - selectedCoreFacts.length - selectedCoreThoughts.length,
  );
  // When both stores have something to say, facts get at least one relevance
  // slot and at most half, so a precise answer is never entirely displaced by
  // narrative and never entirely displaces it.
  const factRelevanceLimit =
    relevantThoughts.length === 0
      ? relevanceLimit
      : Math.min(relevanceLimit, Math.max(1, Math.ceil(relevanceLimit / 2)));

  const relevanceFacts = relevantFacts
    .filter((fact) => !coreFactIds.has(factId(fact)))
    .slice(0, factRelevanceLimit);
  const relevanceThoughts = relevantThoughts
    .filter((thought) => !coreThoughtIds.has(relevantThoughtId(thought)))
    .slice(0, Math.max(0, relevanceLimit - relevanceFacts.length));

  return {
    coreFacts: selectedCoreFacts,
    coreThoughts: selectedCoreThoughts,
    relevanceFacts,
    relevanceThoughts,
  };
}
