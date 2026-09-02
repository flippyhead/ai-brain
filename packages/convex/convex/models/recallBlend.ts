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
 * sequence that gets evaluated. Tiers arrive in this order: exact (facts
 * about an entity the query names), core (facts flagged as identity-grade),
 * then relevance (ranked facts, then ranked memories).
 */

/**
 * Exact hits carry more than a plain fact (the entity the query named), so
 * they get their own type parameter; it must still be a fact so one `factId`
 * serves every tier's dedup.
 */
export type RecallBlendInput<Fact, Thought, Exact extends Fact = Fact> = {
  /** Current facts about entities the query names, best match first. */
  exactFacts: readonly Exact[];
  coreFacts: readonly Fact[];
  relevantFacts: readonly Fact[];
  relevantThoughts: readonly Thought[];
  limit: number;
  factId: (fact: Fact) => string;
};

export type RecallBlend<Fact, Thought, Exact extends Fact = Fact> = {
  exactFacts: Exact[];
  coreFacts: Fact[];
  relevanceFacts: Fact[];
  relevanceThoughts: Thought[];
};

/**
 * Core slots available at a given result limit: at most one.
 *
 * Core is context the question did not ask for. It used to take three of
 * five, which sent the same core set on every call and left two slots for
 * the answer (docs/comparisons/gbrain-bakeoff.md, run 1). One slot carries
 * the identity-grade fact a client should always see, and `recall_context`
 * caps `limit` at eight, so no window it can ask for is wide enough to
 * justify a second.
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
  return limit < 3 ? 0 : 1;
}

/**
 * Exact slots available at a given result limit: facts about an entity the
 * query names by exact name or alias.
 *
 * A named entity is the strongest signal a query carries about what it
 * wants, so its facts go ahead of everything ranked. But a query can name an
 * entity and still be about something only the ranking can find, so exact
 * shares the non-core budget with relevance rather than owning it: at most
 * half of the slots left after core, rounded down, so relevance always keeps
 * at least the other half. `exactLimitFor(5) === 2` — one core, up to two
 * exact, at least two relevance — and `exactLimitFor(8) === 3`.
 *
 * Exact does not reduce core; core is the one slot the question did not ask
 * for, and this tier is the part it asked for most precisely. At limit one
 * there is no exact slot: the entity's fact still reaches the window through
 * keyword relevance, which indexes the name.
 */
export function exactLimitFor(limit: number): number {
  return Math.floor(Math.max(0, limit - coreLimitFor(limit)) / 2);
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

export function blendRecallContext<Fact, Thought, Exact extends Fact = Fact>({
  exactFacts,
  coreFacts,
  relevantFacts,
  relevantThoughts,
  limit,
  factId,
}: RecallBlendInput<Fact, Thought, Exact>): RecallBlend<Fact, Thought, Exact> {
  const selectedExactFacts = exactFacts.slice(0, exactLimitFor(limit));
  const takenIds = new Set(selectedExactFacts.map(factId));

  // A core fact the query named is served once, as exact, and core moves on
  // to the next core fact.
  const selectedCoreFacts = coreFacts
    .filter((fact) => !takenIds.has(factId(fact)))
    .slice(0, coreLimitFor(limit));
  for (const fact of selectedCoreFacts) takenIds.add(factId(fact));

  const relevanceLimit = Math.max(
    0,
    limit - selectedExactFacts.length - selectedCoreFacts.length,
  );
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
    .filter((fact) => !takenIds.has(factId(fact)))
    .slice(0, factRelevanceLimit);
  const relevanceThoughts = relevantThoughts.slice(
    0,
    Math.max(0, relevanceLimit - relevanceFacts.length),
  );

  return {
    exactFacts: selectedExactFacts,
    coreFacts: selectedCoreFacts,
    relevanceFacts,
    relevanceThoughts,
  };
}
