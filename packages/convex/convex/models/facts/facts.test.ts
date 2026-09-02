import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { blendRecallContext, coreLimitFor } from "../recallBlend";
import { listFacts, searchFacts } from "./model";

const issuer = "https://brain.example.test";

describe("structured durable facts", () => {
  const originalIssuer = process.env.MCP_JWT_ISSUER;

  beforeEach(() => {
    process.env.MCP_JWT_ISSUER = issuer;
  });

  afterEach(() => {
    if (originalIssuer === undefined) delete process.env.MCP_JWT_ISSUER;
    else process.env.MCP_JWT_ISSUER = originalIssuer;
  });

  test("stores an exact birth date as a typed, readable, account-owned fact", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });

    const result = await owner.action(api.models.facts.mcpActions.remember, {
      subject: {
        key: "person:zevin",
        kind: "person",
        name: "Zevin",
      },
      predicate: "date_of_birth",
      value: { type: "date", value: "2009-05-12" },
      sourceType: "user_stated",
      isCore: true,
    });

    expect(result).toMatchObject({
      statement: "Zevin — date of birth: 2009-05-12.",
      operation: "stored",
    });
    const stored = await t.run((ctx) => ctx.db.get(result.factId));
    expect(stored).toMatchObject({
      userId,
      predicate: "date_of_birth",
      value: { type: "date", value: "2009-05-12" },
      status: "current",
      confidence: 1,
      isCore: true,
    });
    expect(stored?.validFrom).toBeUndefined();
  });

  test("rejects derived ages and rolls back the subject entity write", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });

    await expect(
      owner.action(api.models.facts.mcpActions.remember, {
        subject: { kind: "person", name: "Zevin" },
        predicate: "age",
        value: { type: "number", value: 17, unit: "years" },
        sourceType: "user_stated",
      }),
    ).rejects.toThrow("Do not store a derived age");

    const [entities, facts] = await t.run(async (ctx) => [
      await ctx.db.query("entities").collect(),
      await ctx.db.query("facts").collect(),
    ]);
    expect(entities).toHaveLength(0);
    expect(facts).toHaveLength(0);
  });

  test("deduplicates an identical fact and keeps a stable entity identity", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });
    const args = {
      subject: {
        key: "person:jordan",
        kind: "person" as const,
        name: "Jordan Schwartz",
        aliases: ["Jordan"],
      },
      predicate: "home_city",
      value: { type: "text" as const, value: "Seattle" },
      sourceType: "user_stated" as const,
    };

    const first = await owner.action(
      api.models.facts.mcpActions.remember,
      args,
    );
    const duplicate = await owner.action(api.models.facts.mcpActions.remember, {
      ...args,
      subject: { ...args.subject, name: "Jordan", aliases: ["J. Schwartz"] },
    });

    expect(duplicate).toMatchObject({
      factId: first.factId,
      operation: "noop",
    });
    const [entities, facts] = await t.run(async (ctx) => [
      await ctx.db.query("entities").collect(),
      await ctx.db.query("facts").collect(),
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      key: "person:jordan",
      canonicalName: "Jordan Schwartz",
    });
    expect(entities[0]?.aliases).toEqual(
      expect.arrayContaining(["Jordan", "J. Schwartz"]),
    );
    expect(facts).toHaveLength(1);
  });

  test("preserves a changed PCP relationship with explicit business time", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });
    const startedOld = Date.UTC(2020, 0, 1);
    const startedNew = Date.UTC(2026, 7, 1);
    const base = {
      subject: {
        key: "person:jordan",
        kind: "person" as const,
        name: "Jordan",
      },
      predicate: "primary_care_provider",
      sourceType: "user_stated" as const,
    };

    const oldFact = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: {
        type: "entity" as const,
        entity: {
          key: "person:dr-old",
          kind: "person" as const,
          name: "Dr. Old",
        },
      },
      validFrom: startedOld,
    });
    const newFact = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: {
        type: "entity" as const,
        entity: {
          key: "person:dr-new",
          kind: "person" as const,
          name: "Dr. New",
        },
      },
      validFrom: startedNew,
      changeKind: "changed",
      changeReason: "Jordan changed primary care providers",
    });

    expect(newFact.operation).toBe("superseded");
    const [oldStored, newStored] = await t.run(async (ctx) => [
      await ctx.db.get(oldFact.factId),
      await ctx.db.get(newFact.factId),
    ]);
    expect(oldStored).toMatchObject({
      status: "superseded",
      validFrom: startedOld,
      validTo: startedNew,
      supersededBy: newFact.factId,
    });
    expect(newStored).toMatchObject({
      status: "current",
      validFrom: startedNew,
      supersedes: [oldFact.factId],
    });
  });

  test("retracts an inaccurate value without pretending it was formerly true", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });
    const base = {
      subject: { kind: "person" as const, name: "Zevin" },
      predicate: "date_of_birth",
      sourceType: "user_stated" as const,
    };
    const wrong = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: { type: "date", value: "2009-05-11" },
      validFrom: Date.UTC(2009, 4, 11),
    });
    const corrected = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: { type: "date", value: "2009-05-12" },
      changeKind: "corrected",
    });

    expect(corrected.operation).toBe("corrected");
    const prior = await t.run((ctx) => ctx.db.get(wrong.factId));
    expect(prior?.status).toBe("retracted");
    expect(prior?.validFrom).toBeUndefined();
    expect(prior?.validTo).toBeUndefined();

    // A historical read may surface what was formerly true. It must never
    // surface what was never true, or a correction reads as a change.
    const history = await owner.query(api.models.facts.mcpQueries.search, {
      query: "Zevin date of birth",
      includeHistorical: true,
    });
    const returnedIds = history.map((fact: { id: string }) => fact.id);
    expect(returnedIds).toContain(corrected.factId);
    expect(returnedIds).not.toContain(wrong.factId);
  });

  test("rejects an entity key whose prefix contradicts its kind", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });

    await expect(
      owner.action(api.models.facts.mcpActions.remember, {
        subject: {
          key: "organization:acme",
          kind: "person",
          name: "Acme",
        },
        predicate: "home_city",
        value: { type: "text", value: "Seattle" },
        sourceType: "user_stated",
      }),
    ).rejects.toThrow("Entity key must begin with its kind");

    const entities = await t.run((ctx) => ctx.db.query("entities").collect());
    expect(entities).toHaveLength(0);
  });

  test("offers only current facts as narrative coverage", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });
    const base = {
      subject: { kind: "person" as const, name: "Zevin" },
      predicate: "date_of_birth",
      sourceType: "user_stated" as const,
    };
    const wrong = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: { type: "date", value: "2009-05-11" },
    });
    const corrected = await owner.action(api.models.facts.mcpActions.remember, {
      ...base,
      value: { type: "date", value: "2009-05-12" },
      changeKind: "corrected",
    });

    // Coverage decides whether narrative capture is refused. Offering a
    // retracted fact would refuse a capture on the strength of a value the
    // user already corrected.
    const covering = await t.run((ctx) =>
      ctx.runQuery(internal.models.facts.private.searchCoveringFacts, {
        userId,
        query: "Zevin date of birth",
      }),
    );
    const ids = covering.map((fact: { id: string }) => fact.id);
    expect(ids).toContain(corrected.factId);
    expect(ids).not.toContain(wrong.factId);
  });

  test("scores the eval harness on the fact window recall_context serves", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ issuer, subject: userId });
    // Two core facts. The older one is also the best keyword match, so at the
    // default limit it belongs in the relevance slot: core takes one, and the
    // newer fact takes it.
    const older = await owner.action(api.models.facts.mcpActions.remember, {
      subject: { key: "person:zevin", kind: "person", name: "Zevin" },
      predicate: "school",
      value: { type: "text", value: "Redwood Academy" },
      sourceType: "user_stated",
      isCore: true,
    });
    const newer = await owner.action(api.models.facts.mcpActions.remember, {
      subject: { key: "person:avery", kind: "person", name: "Avery" },
      predicate: "home_city",
      value: { type: "text", value: "Fernwood" },
      sourceType: "user_stated",
      isCore: true,
    });
    const limit = 5;
    const query = "Zevin school Redwood Academy";
    const noThoughts: Array<{ _id: string }> = [];

    // What recall_context fetches, then blends.
    const [mcpCore, mcpRelevant] = await Promise.all([
      owner.query(api.models.facts.mcpQueries.listCore, {
        limit: coreLimitFor(limit),
      }),
      owner.action(api.models.facts.mcpActions.search, { query, limit }),
    ]);
    const mcpWindow = blendRecallContext({
      coreFacts: mcpCore,
      relevantFacts: mcpRelevant,
      relevantThoughts: noThoughts,
      limit,
      factId: (fact) => fact.id as string,
    });
    expect(mcpWindow.coreFacts.map((fact) => fact.id)).toEqual([newer.factId]);
    expect(mcpWindow.relevanceFacts.map((fact) => fact.id)).toEqual([
      older.factId,
    ]);

    // What the harness fetches, then blends. A wider core fetch than the
    // blend will select must not hide the older fact from the relevance
    // slot: dedup belongs to the blend, against the core it selected.
    const rows = await t.action(internal.models.facts.actions.recall, {
      userId,
      query,
      limit,
      coreLimit: 5,
    });
    expect(
      rows
        .filter((row: { source: string }) => row.source === "relevant")
        .map((row: { id: string }) => row.id),
    ).toContain(older.factId);
    const evalWindow = blendRecallContext({
      coreFacts: rows.filter(
        (row: { source: string }) => row.source === "core",
      ),
      relevantFacts: rows.filter(
        (row: { source: string }) => row.source === "relevant",
      ),
      relevantThoughts: noThoughts,
      limit,
      factId: (row: { id: string }) => row.id,
    });
    expect(evalWindow.coreFacts.map((row: { id: string }) => row.id)).toEqual(
      mcpWindow.coreFacts.map((fact) => fact.id),
    );
    expect(
      evalWindow.relevanceFacts.map((row: { id: string }) => row.id),
    ).toEqual(mcpWindow.relevanceFacts.map((fact) => fact.id));
  });

  test("keeps MCP and dashboard fact reads isolated by account and issuer", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });
    await owner.action(api.models.facts.mcpActions.remember, {
      subject: { kind: "person", name: "Jordan" },
      predicate: "home_city",
      value: { type: "text", value: "Seattle" },
      sourceType: "user_stated",
      isCore: true,
    });

    expect(await other.query(api.models.facts.mcpQueries.listCore, {})).toEqual(
      [],
    );
    const searchResults = await owner.query(
      api.models.facts.mcpQueries.search,
      { query: "Jordan home city Seattle" },
    );
    expect(searchResults.map((fact) => fact.statement)).toEqual([
      "Jordan — home city: Seattle.",
    ]);
    await expect(
      owner.query(api.models.facts.public.listRecent, {}),
    ).rejects.toThrow("Not authenticated");
    const dashboard = t.withIdentity({
      issuer: "https://brain.example.test/convex",
      subject: ownerId,
    });
    const visible = await dashboard.query(
      api.models.facts.public.listRecent,
      {},
    );
    expect(visible.map((fact) => fact.statement)).toEqual([
      "Jordan — home city: Seattle.",
    ]);
  });

  test("fills fact result limits after lifecycle filtering", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    await t.run(async (ctx) => {
      const subjectEntityId = await ctx.db.insert("entities", {
        userId,
        key: "person:pagination-test",
        kind: "person",
        canonicalName: "Pagination Test",
        normalizedName: "pagination test",
        aliases: [],
        normalizedAliases: [],
      });
      const insertFact = (
        index: number,
        status: "current" | "retracted",
        validFrom?: number,
      ) =>
        ctx.db.insert("facts", {
          userId,
          subjectEntityId,
          predicate: "school",
          value: { type: "text", value: `School ${index}` },
          statement: `Pagination Test — school: School ${index}.`,
          searchText: `pagination sentinel school School ${index}`,
          sourceType: "user_stated",
          confidence: 1,
          isCore: true,
          validFrom,
          status,
        });

      // Retrievable rows are deliberately older. The scheduled rows exhaust
      // the old current-only `take(limit * 5)` window, while the still-newer
      // retractions exhaust its historical window.
      for (let index = 0; index < 10; index += 1) {
        await insertFact(index, "current");
      }
      for (let index = 10; index < 70; index += 1) {
        await insertFact(index, "current", Date.now() + 86_400_000);
      }
      for (let index = 70; index < 130; index += 1) {
        await insertFact(index, "retracted");
      }
    });

    const recent = await t.run((ctx) => listFacts(ctx, userId, { limit: 10 }));
    const core = await t.run((ctx) =>
      listFacts(ctx, userId, { limit: 10, coreOnly: true }),
    );
    const historical = await t.run((ctx) =>
      listFacts(ctx, userId, { limit: 10, includeHistorical: true }),
    );
    const search = await t.run((ctx) =>
      searchFacts(ctx, userId, "pagination sentinel school", { limit: 10 }),
    );
    const historicalSearch = await t.run((ctx) =>
      searchFacts(ctx, userId, "pagination sentinel school", {
        limit: 10,
        includeHistorical: true,
      }),
    );

    for (const results of [
      recent,
      core,
      historical,
      search,
      historicalSearch,
    ]) {
      expect(results).toHaveLength(10);
      expect(results.every((fact) => fact.status !== "retracted")).toBe(true);
    }
  });
});
