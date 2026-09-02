import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";

const issuer = "https://brain.example.test";
const DIMENSIONS = 1536;

/**
 * A deterministic stand-in for text-embedding-3-small. Only a small concept
 * vocabulary contributes to the vector and synonyms share a concept, so
 * "mental health" and "therapist" land on the same dimension while names and
 * stop words contribute nothing. Semantic reach and keyword reach are then
 * independently controllable: a name is visible to the keyword index and
 * invisible to the vector, a paraphrase is the other way round.
 */
const CONCEPTS: Record<string, string> = {
  therapist: "therapist",
  therapy: "therapist",
  counselor: "therapist",
  counseling: "therapist",
  mental: "therapist",
  health: "therapist",
  dr: "doctor",
  doctor: "doctor",
  city: "city",
  home: "city",
  seattle: "city",
};

function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  let hits = 0;
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const concept = CONCEPTS[token];
    if (concept === undefined) continue;
    let slot = 7;
    for (const ch of concept)
      slot = (slot * 31 + ch.charCodeAt(0)) % DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
    hits += 1;
  }
  // Every vector stays non-zero so cosine similarity is always defined.
  if (hits === 0) vector[DIMENSIONS - 1] = 1;
  return vector;
}

/** Answers embedding requests deterministically and records their inputs. */
function stubEmbeddingProvider(): string[] {
  const inputs: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const { input } = JSON.parse(init?.body ?? "{}") as { input: string };
      inputs.push(input);
      return new Response(
        JSON.stringify({ data: [{ embedding: fakeEmbedding(input) }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return inputs;
}

function stubUnavailableProvider(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" }),
    ),
  );
}

type Owner = ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

function rememberTherapist(
  owner: Owner,
  subject: string,
  therapist: string,
  extra: {
    validFrom?: number;
    changeKind?: "changed" | "corrected";
    isCore?: boolean;
  } = {},
) {
  return owner.action(api.models.facts.mcpActions.remember, {
    subject: { kind: "person", name: subject },
    predicate: "therapist",
    value: { type: "text", value: therapist },
    sourceType: "user_stated",
    ...extra,
  });
}

const SEMANTIC_QUERY = "who do I see for mental health";

describe("semantic recall for facts", () => {
  const originalIssuer = process.env.MCP_JWT_ISSUER;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.MCP_JWT_ISSUER = issuer;
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalIssuer === undefined) delete process.env.MCP_JWT_ISSUER;
    else process.env.MCP_JWT_ISSUER = originalIssuer;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  describe("write path", () => {
    test("embeds the stored search text when a fact is remembered", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      const inputs = stubEmbeddingProvider();

      const result = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");

      expect(result.operation).toBe("stored");
      const stored = await t.run((ctx) => ctx.db.get(result.factId));
      expect(stored?.embedding).toHaveLength(DIMENSIONS);
      // The vector describes exactly what the keyword index sees.
      expect(inputs).toEqual([stored?.searchText]);
      expect(stored?.embedding).toEqual(fakeEmbedding(stored!.searchText));
    });

    test("stores the fact without an embedding when the provider fails, and keyword search still finds it", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubUnavailableProvider();

      const result = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");

      expect(result.operation).toBe("stored");
      const stored = await t.run((ctx) => ctx.db.get(result.factId));
      expect(stored?.status).toBe("current");
      expect(stored?.embedding).toBeUndefined();

      // The fused search degrades to the keyword ranking rather than failing.
      const found = await owner.action(api.models.facts.mcpActions.search, {
        query: "Jordan therapist",
      });
      expect(found.map((fact) => fact.id)).toEqual([result.factId]);
    });

    test("fills in a missing embedding on a repeat write and skips one that is still accurate", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });

      stubUnavailableProvider();
      const first = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      expect(
        (await t.run((ctx) => ctx.db.get(first.factId)))?.embedding,
      ).toBeUndefined();

      const inputs = stubEmbeddingProvider();
      const repeat = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      expect(repeat).toMatchObject({ factId: first.factId, operation: "noop" });
      expect(
        (await t.run((ctx) => ctx.db.get(first.factId)))?.embedding,
      ).toHaveLength(DIMENSIONS);
      expect(inputs).toHaveLength(1);

      // Identical text, existing vector: no embedding call is spent.
      await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      expect(inputs).toHaveLength(1);
    });

    test("gives a replacement its own embedding and lets the superseded fact keep its vector", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubEmbeddingProvider();

      const prior = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee", {
        validFrom: Date.UTC(2020, 0, 1),
      });
      const replacement = await rememberTherapist(
        owner,
        "Jordan",
        "Dr. Kim Park",
        { validFrom: Date.UTC(2026, 7, 1), changeKind: "changed" },
      );

      expect(replacement.operation).toBe("superseded");
      const [priorStored, replacementStored] = await t.run(async (ctx) => [
        await ctx.db.get(prior.factId),
        await ctx.db.get(replacement.factId),
      ]);
      expect(priorStored?.status).toBe("superseded");
      expect(priorStored?.embedding).toEqual(
        fakeEmbedding(priorStored!.searchText),
      );
      expect(replacementStored?.embedding).toEqual(
        fakeEmbedding(replacementStored!.searchText),
      );
    });
  });

  describe("fused search", () => {
    test("reaches a fact by meaning when no keyword matches", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubEmbeddingProvider();

      const therapist = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      await owner.action(api.models.facts.mcpActions.remember, {
        subject: { kind: "person", name: "Jordan" },
        predicate: "home_city",
        value: { type: "text", value: "Seattle" },
        sourceType: "user_stated",
      });

      // The defect this workstream fixes: the keyword index cannot serve a
      // paraphrase of the predicate.
      const keywordOnly = await owner.query(
        api.models.facts.mcpQueries.search,
        {
          query: SEMANTIC_QUERY,
        },
      );
      expect(keywordOnly).toEqual([]);

      const fused = await owner.action(api.models.facts.mcpActions.search, {
        query: SEMANTIC_QUERY,
      });
      expect(fused[0]?.id).toBe(therapist.factId);
      expect(fused[0]?.statement).toBe("Jordan — therapist: Dr. Sam Lee.");
    });

    test("fuses keyword and vector ranks with reciprocal rank fusion", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubEmbeddingProvider();

      // "Dr." adds a concept the query lacks, so Jordan's fact is the weaker
      // vector match; Riley's is a perfect one.
      const jordan = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      const riley = await rememberTherapist(owner, "Riley", "Sam Kim");

      // Vector alone ranks Riley first.
      const byMeaning = await owner.action(api.models.facts.mcpActions.search, {
        query: "mental health",
      });
      expect(byMeaning.map((fact) => fact.id)).toEqual([
        riley.factId,
        jordan.factId,
      ]);

      // Naming Jordan adds a keyword hit the vector ignores. With K = 60 and
      // one-based ranks, 1/61 + 1/62 (Jordan: keyword rank 1, vector rank 2)
      // beats 1/61 (Riley: vector rank 1 only), so the fused order flips.
      const fused = await owner.action(api.models.facts.mcpActions.search, {
        query: "Jordan mental health",
      });
      expect(fused.map((fact) => fact.id)).toEqual([
        jordan.factId,
        riley.factId,
      ]);
    });

    test("applies lifecycle rules on the vector path", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubEmbeddingProvider();

      const superseded = await rememberTherapist(
        owner,
        "Jordan",
        "Dr. Sam Lee",
        { validFrom: Date.UTC(2020, 0, 1) },
      );
      const current = await rememberTherapist(owner, "Jordan", "Dr. Kim Park", {
        validFrom: Date.UTC(2026, 7, 1),
        changeKind: "changed",
      });
      const retracted = await rememberTherapist(owner, "Riley", "Wrong Name");
      const corrected = await rememberTherapist(owner, "Riley", "Sam Kim", {
        changeKind: "corrected",
      });
      const scheduled = await rememberTherapist(
        owner,
        "Casey",
        "Dr. Lee Park",
        {
          validFrom: Date.now() + 86_400_000,
        },
      );

      // The query has no keyword overlap, so every hit below came through the
      // vector index, which cannot filter lifecycle itself.
      const currentOnly = await owner.action(
        api.models.facts.mcpActions.search,
        { query: SEMANTIC_QUERY },
      );
      expect(currentOnly.map((fact) => fact.id).sort()).toEqual(
        [current.factId, corrected.factId].sort(),
      );

      const historical = await owner.action(
        api.models.facts.mcpActions.search,
        { query: SEMANTIC_QUERY, includeHistorical: true },
      );
      const historicalIds = historical.map((fact) => fact.id);
      expect(historicalIds.sort()).toEqual(
        [
          current.factId,
          corrected.factId,
          superseded.factId,
          scheduled.factId,
        ].sort(),
      );
      expect(historicalIds).not.toContain(retracted.factId);
    });

    test("keeps vector recall isolated by account", async () => {
      const t = convexTest(schema, modules);
      const [ownerId, otherId, emptyId] = await t.run(async (ctx) => [
        await ctx.db.insert("users", {}),
        await ctx.db.insert("users", {}),
        await ctx.db.insert("users", {}),
      ]);
      const owner = t.withIdentity({ issuer, subject: ownerId });
      const other = t.withIdentity({ issuer, subject: otherId });
      const empty = t.withIdentity({ issuer, subject: emptyId });
      stubEmbeddingProvider();

      const ownerFact = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");
      const otherFact = await rememberTherapist(other, "Jordan", "Dr. Sam Lee");

      const forOwner = await owner.action(api.models.facts.mcpActions.search, {
        query: SEMANTIC_QUERY,
      });
      const forOther = await other.action(api.models.facts.mcpActions.search, {
        query: SEMANTIC_QUERY,
      });
      const forEmpty = await empty.action(api.models.facts.mcpActions.search, {
        query: SEMANTIC_QUERY,
      });

      expect(forOwner.map((fact) => fact.id)).toEqual([ownerFact.factId]);
      expect(forOther.map((fact) => fact.id)).toEqual([otherFact.factId]);
      expect(forEmpty).toEqual([]);
    });

    test("serves recall_context's fact half through the fused path", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      stubEmbeddingProvider();

      const core = await owner.action(api.models.facts.mcpActions.remember, {
        subject: { kind: "person", name: "Jordan" },
        predicate: "home_city",
        value: { type: "text", value: "Seattle" },
        sourceType: "user_stated",
        isCore: true,
      });
      const therapist = await rememberTherapist(owner, "Jordan", "Dr. Sam Lee");

      // The evaluation harness calls the same helper from its own action, so
      // this is the shape it scores.
      const rows = await t.action(internal.models.facts.actions.recall, {
        userId,
        query: SEMANTIC_QUERY,
      });

      expect(rows.map((row) => [row.source, row.id])).toEqual([
        ["core", core.factId],
        ["relevant", therapist.factId],
      ]);
    });
  });

  describe("backfill", () => {
    async function seedRawFacts(
      t: ReturnType<typeof convexTest>,
      userId: Id<"users">,
      count: number,
      withEmbedding = false,
    ): Promise<Array<Id<"facts">>> {
      return await t.run(async (ctx) => {
        const subjectEntityId = await ctx.db.insert("entities", {
          userId,
          key: `person:seed-${withEmbedding ? "embedded" : "bare"}`,
          kind: "person",
          canonicalName: "Seed",
          normalizedName: "seed",
          aliases: [],
          normalizedAliases: [],
        });
        const ids: Array<Id<"facts">> = [];
        for (let index = 0; index < count; index += 1) {
          const searchText = `seed therapist therapist Dr. Person ${index}`;
          ids.push(
            await ctx.db.insert("facts", {
              userId,
              subjectEntityId,
              predicate: "therapist",
              value: { type: "text", value: `Dr. Person ${index}` },
              statement: `Seed — therapist: Dr. Person ${index}.`,
              searchText,
              sourceType: "user_stated",
              confidence: 1,
              status: "current",
              ...(withEmbedding
                ? { embedding: fakeEmbedding(searchText) }
                : {}),
            }),
          );
        }
        return ids;
      });
    }

    async function missingCount(t: ReturnType<typeof convexTest>) {
      const facts = await t.run((ctx) => ctx.db.query("facts").collect());
      return facts.filter((fact) => fact.embedding === undefined).length;
    }

    test("embeds only the facts that lack a vector and is idempotent", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      await seedRawFacts(t, userId, 3);
      const embedded = (await seedRawFacts(t, userId, 1, true))[0]!;
      const inputs = stubEmbeddingProvider();

      const first = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );
      expect(first).toMatchObject({
        scanned: 4,
        needingBackfill: 3,
        patched: 3,
        failed: 0,
        isDone: true,
        cursor: null,
      });
      expect(inputs).toHaveLength(3);
      expect(await missingCount(t)).toBe(0);
      const untouched = await t.run((ctx) => ctx.db.get(embedded));
      expect(untouched?.embedding).toEqual(
        fakeEmbedding(untouched!.searchText),
      );

      const second = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );
      expect(second).toMatchObject({ needingBackfill: 0, patched: 0 });
      expect(inputs).toHaveLength(3);
    });

    test("makes backfilled facts reachable by meaning", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const owner = t.withIdentity({ issuer, subject: userId });
      const ids = await seedRawFacts(t, userId, 2);
      stubEmbeddingProvider();

      await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );

      const found = await owner.action(api.models.facts.mcpActions.search, {
        query: SEMANTIC_QUERY,
      });
      expect(found.map((fact) => fact.id).sort()).toEqual([...ids].sort());
    });

    test("dryRun counts without writing", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      await seedRawFacts(t, userId, 2);
      const inputs = stubEmbeddingProvider();

      const dry = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        { dryRun: true },
      );
      expect(dry).toMatchObject({ needingBackfill: 2, patched: 0 });
      expect(inputs).toHaveLength(0);
      expect(await missingCount(t)).toBe(2);
    });

    test("resumes from a returned cursor across bounded batches", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      await seedRawFacts(t, userId, 7);
      stubEmbeddingProvider();

      const partial = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        { batchSize: 3, maxBatches: 1 },
      );
      expect(partial).toMatchObject({ scanned: 3, patched: 3, isDone: false });
      expect(partial.cursor).not.toBeNull();
      expect(await missingCount(t)).toBe(4);

      const rest = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        { batchSize: 3, cursor: partial.cursor! },
      );
      expect(rest).toMatchObject({ patched: 4, isDone: true, cursor: null });
      expect(await missingCount(t)).toBe(0);
    });

    test("leaves facts for the next run when the provider fails", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      await seedRawFacts(t, userId, 2);

      stubUnavailableProvider();
      const failed = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );
      expect(failed).toMatchObject({
        needingBackfill: 2,
        patched: 0,
        failed: 2,
        isDone: true,
      });
      expect(await missingCount(t)).toBe(2);

      stubEmbeddingProvider();
      const recovered = await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );
      expect(recovered).toMatchObject({ patched: 2, failed: 0 });
      expect(await missingCount(t)).toBe(0);
    });

    test("audit reports zero once the backfill has run", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      await seedRawFacts(t, userId, 2);
      stubEmbeddingProvider();

      const before = await t.query(
        internal.models.facts.migrations.countMissingFactEmbeddings,
        {},
      );
      expect(before.missing).toBe(2);

      await t.action(
        internal.models.facts.migrations.backfillFactEmbeddings,
        {},
      );

      const after = await t.query(
        internal.models.facts.migrations.countMissingFactEmbeddings,
        {},
      );
      expect(after.missing).toBe(0);
    });
  });
});
