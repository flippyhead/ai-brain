import { internalAction, internalMutation } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import {
  evaluateRetrievalCase,
  type RetrievalEvaluationResult,
} from "./memoryEval";
import { liveRecallCorpus, type SeedMemory } from "./memoryEval.corpus";
import { blendRecallContext, coreLimitFor } from "../recallBlend";

// Matches the pattern in mcpActions.ts: the generated API type collapses under
// action-to-action recursion.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

/** Baseline searches request ten results and are scored at both cutoffs. */
const SEARCH_LIMIT = 10;

function parseValidity(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Corpus validity date is not parseable: ${value}`);
  }
  return parsed;
}

function seedMetadata(memory: SeedMemory) {
  return {
    type: "reference" as const,
    topics: [],
    people: [],
    actionItems: [],
    summary: memory.content,
  };
}

export const createEvalUser = internalMutation({
  args: { label: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", { name: `memory-eval-${args.label}` });
  },
});

export const deleteEvalSeed = internalMutation({
  args: {
    thoughtIds: v.array(v.id("thoughts")),
    factIds: v.optional(v.array(v.id("facts"))),
    userIds: v.array(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const id of args.thoughtIds) await ctx.db.delete(id);
    for (const id of args.factIds ?? []) await ctx.db.delete(id);
    // Entities are created implicitly by fact writes, so they are removed by
    // owner rather than by collected id.
    for (const userId of args.userIds) {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
      for (const entity of entities) await ctx.db.delete(entity._id);
    }
    for (const id of args.userIds) await ctx.db.delete(id);
    return null;
  },
});

/**
 * Seed two accounts, run every corpus query through the production hybrid
 * retriever, and score the real rankings with the same function CI uses on
 * recorded results.
 *
 * Run against a development deployment:
 *   pnpm eval:recall
 *
 * Seeded records are removed before the action returns unless keepSeed is set.
 */
export const runBaseline = internalAction({
  args: { keepSeed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userIdByLabel = new Map<string, Id<"users">>();
    const thoughtIdByKey = new Map<string, Id<"thoughts">>();
    // Reverse lookup so a result belonging to the other account is attributed
    // to it rather than silently ignored.
    const ownerByThoughtId = new Map<string, { key: string; label: string }>();
    const createdThoughtIds: Array<Id<"thoughts">> = [];
    const factIdByKey = new Map<string, Id<"facts">>();
    const ownerByFactId = new Map<string, { key: string; label: string }>();
    const createdFactIds: Array<Id<"facts">> = [];

    try {
      for (const account of liveRecallCorpus) {
        const userId: Id<"users"> = await ctx.runMutation(
          internal.models.thoughts.evalRecall.createEvalUser,
          { label: account.label },
        );
        userIdByLabel.set(account.label, userId);

        for (const memory of account.memories) {
          const embedding: number[] = await ctx.runAction(
            internal.models.thoughts.helpers.generateEmbedding,
            { text: memory.content },
          );
          const shared = {
            content: memory.content,
            embedding,
            metadata: seedMetadata(memory),
            userId,
            validFrom: parseValidity(memory.validFrom),
            validTo: parseValidity(memory.validTo),
            isCore: memory.isCore,
          };

          const priorKey = memory.supersedes ?? memory.retracts;
          let thoughtId: Id<"thoughts">;
          if (priorKey === undefined) {
            thoughtId = await ctx.runMutation(
              internal.models.thoughts.private.insertOne,
              shared,
            );
          } else {
            const priorId = thoughtIdByKey.get(priorKey);
            if (priorId === undefined) {
              throw new Error(
                `Corpus memory "${memory.key}" references unseeded key "${priorKey}"`,
              );
            }
            thoughtId = await ctx.runMutation(
              internal.models.thoughts.private.transitionMemory,
              {
                ...shared,
                previousIds: [priorId],
                previousStatus:
                  memory.retracts === undefined ? "superseded" : "retracted",
                reason: "memory eval baseline seed",
                transitionedAt: Date.now(),
              },
            );
          }

          thoughtIdByKey.set(memory.key, thoughtId);
          ownerByThoughtId.set(thoughtId, {
            key: memory.key,
            label: account.label,
          });
          createdThoughtIds.push(thoughtId);
        }

        for (const fact of account.facts ?? []) {
          if (fact.corrects !== undefined) {
            const prior = (account.facts ?? []).find(
              (candidate) => candidate.key === fact.corrects,
            );
            // Correction metadata is driven by subject and predicate, so a
            // dangling or mismatched reference would silently seed an ordinary
            // fact and quietly weaken the case that depends on it.
            if (
              prior === undefined ||
              !factIdByKey.has(fact.corrects) ||
              prior.subjectKey !== fact.subjectKey ||
              prior.predicate !== fact.predicate
            ) {
              throw new Error(
                `Corpus fact "${fact.key}" corrects "${fact.corrects}", which is not an already-seeded fact with the same subject and predicate`,
              );
            }
          }
          const result: { factId: Id<"facts"> } = await ctx.runMutation(
            internal.models.facts.private.seedFact,
            {
              userId,
              subject: {
                key: fact.subjectKey,
                kind: "person",
                name: fact.subjectName,
              },
              predicate: fact.predicate,
              value: { type: "text", value: fact.value },
              sourceType: "user_stated",
              isCore: fact.isCore,
              validFrom: parseValidity(fact.validFrom),
              changeKind: fact.corrects === undefined ? undefined : "corrected",
              changeReason:
                fact.corrects === undefined
                  ? undefined
                  : "memory eval baseline seed",
            },
          );
          factIdByKey.set(fact.key, result.factId);
          ownerByFactId.set(result.factId as string, {
            key: fact.key,
            label: account.label,
          });
          createdFactIds.push(result.factId);
        }
      }

      const cases = [];
      for (const account of liveRecallCorpus) {
        const userId = userIdByLabel.get(account.label)!;
        for (const query of account.queries) {
          const hits: Array<{
            _id: Id<"thoughts">;
            content: string;
            memoryStatus: "current" | "superseded" | "retracted";
          }> = await ctx.runAction(
            internal.models.thoughts.actions.hybridSearch,
            {
              userId,
              query: query.query,
              limit: SEARCH_LIMIT,
              includeHistorical: query.includeHistorical,
            },
          );

          const factRows: Array<{
            id: string;
            statement: string;
            status: string;
            source: "core" | "relevant";
          }> = await ctx.runQuery(internal.models.facts.private.recallFacts, {
            userId,
            query: query.query,
            // Exactly what recall_context fetches at SEARCH_LIMIT. Core facts
            // come newest first, so the fetch at a smaller cutoff is a prefix
            // of this one and the blend slices it per cutoff.
            limit: SEARCH_LIMIT,
            coreLimit: coreLimitFor(SEARCH_LIMIT),
            includeHistorical: query.includeHistorical,
          });

          const toFactResult = (row: {
            id: string;
            statement: string;
            status: string;
          }): RetrievalEvaluationResult => {
            const owner = ownerByFactId.get(row.id);
            return {
              id: owner?.key ?? `unseeded:${row.id}`,
              userId: owner?.label ?? "unknown",
              memoryStatus:
                row.status === "superseded" || row.status === "retracted"
                  ? row.status
                  : "current",
              content: row.statement,
            };
          };

          const toThoughtResult = (hit: {
            _id: Id<"thoughts">;
            content: string;
            memoryStatus: "current" | "superseded" | "retracted";
          }): RetrievalEvaluationResult => {
            const owner = ownerByThoughtId.get(hit._id);
            return {
              // An unseeded id means the deployment held pre-existing data;
              // attribute it to neither account so it counts as a leak.
              id: owner?.key ?? `unseeded:${hit._id}`,
              userId: owner?.label ?? "unknown",
              memoryStatus: hit.memoryStatus,
              content: hit.content,
            };
          };

          // Score the window a client actually receives. `recall_context`
          // defaults to five results, so the blend is rebuilt per cutoff rather
          // than sliced from one oversized list — the core allocation itself
          // depends on the limit.
          const blendAt = (limit: number): RetrievalEvaluationResult[] => {
            const blend = blendRecallContext({
              coreFacts: factRows.filter((row) => row.source === "core"),
              relevantFacts: factRows.filter(
                (row) => row.source === "relevant",
              ),
              relevantThoughts: hits,
              limit,
              factId: (row) => row.id,
            });
            return [
              ...blend.coreFacts.map(toFactResult),
              ...blend.relevanceFacts.map(toFactResult),
              ...blend.relevanceThoughts.map(toThoughtResult),
            ];
          };

          const blendedAtFive = blendAt(5);
          const blendedResults = blendAt(SEARCH_LIMIT);

          const shared = {
            name: `${account.label}: ${query.name}`,
            query: query.query,
            expectedUserId: account.label,
            expectedIds: query.expectedKeys,
            includeHistorical: query.includeHistorical,
            expectedExactStrings: query.expectedExactStrings,
            forbiddenExactStrings: query.forbiddenExactStrings,
            results: blendedResults,
          };
          const atFive = evaluateRetrievalCase({
            ...shared,
            results: blendedAtFive,
            k: 5,
          });
          const atTen = evaluateRetrievalCase({ ...shared, k: SEARCH_LIMIT });

          cases.push({
            name: shared.name,
            recallAtFive: atFive.recallAtK,
            recallAtTen: atTen.recallAtK,
            leakedIds: atTen.tenantLeakIds,
            retractedOrStaleIds: atTen.unexpectedHistoricalIds,
            missingExactStrings: atTen.missingExactStrings,
            presentForbiddenStrings: atTen.presentForbiddenStrings,
            returnedKeys: blendedResults.map((result) => result.id),
          });
        }
      }

      const mean = (values: number[]) =>
        values.length === 0
          ? 0
          : Math.round(
              (values.reduce((total, value) => total + value, 0) /
                values.length) *
                1000,
            ) / 1000;

      const blocking = cases.filter(
        (result) =>
          result.leakedIds.length > 0 ||
          result.retractedOrStaleIds.length > 0 ||
          result.presentForbiddenStrings.length > 0,
      );
      const summary = {
        recallAtFive: mean(cases.map((result) => result.recallAtFive)),
        recallAtTen: mean(cases.map((result) => result.recallAtTen)),
        blockingFailures: blocking.map((result) => result.name),
        passed: blocking.length === 0,
        cases,
      };

      // An account leak or a retracted memory presented as history is a release
      // blocker, so it has to fail the process rather than appear in returned
      // JSON that a caller has to remember to inspect. Throwing still runs the
      // cleanup in `finally`.
      if (blocking.length > 0) {
        throw new Error(
          `Recall baseline failed (R@5 ${summary.recallAtFive}, R@10 ${summary.recallAtTen}). ` +
            blocking
              .map((result) =>
                [
                  result.name,
                  result.leakedIds.length > 0
                    ? `leaked: ${result.leakedIds.join(", ")}`
                    : null,
                  result.retractedOrStaleIds.length > 0
                    ? `retracted or stale: ${result.retractedOrStaleIds.join(", ")}`
                    : null,
                  result.presentForbiddenStrings.length > 0
                    ? `forbidden value present: ${result.presentForbiddenStrings.join(", ")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" — "),
              )
              .join("; "),
        );
      }

      return summary;
    } finally {
      if (!args.keepSeed) {
        await ctx.runMutation(
          internal.models.thoughts.evalRecall.deleteEvalSeed,
          {
            thoughtIds: createdThoughtIds,
            factIds: createdFactIds,
            userIds: [...userIdByLabel.values()],
          },
        );
      }
    }
  },
});
