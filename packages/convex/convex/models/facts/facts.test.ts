import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";

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

    const result = await owner.mutation(api.models.facts.mcpActions.remember, {
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
      owner.mutation(api.models.facts.mcpActions.remember, {
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

    const first = await owner.mutation(
      api.models.facts.mcpActions.remember,
      args,
    );
    const duplicate = await owner.mutation(
      api.models.facts.mcpActions.remember,
      {
        ...args,
        subject: { ...args.subject, name: "Jordan", aliases: ["J. Schwartz"] },
      },
    );

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

    const oldFact = await owner.mutation(api.models.facts.mcpActions.remember, {
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
    const newFact = await owner.mutation(api.models.facts.mcpActions.remember, {
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
    const wrong = await owner.mutation(api.models.facts.mcpActions.remember, {
      ...base,
      value: { type: "date", value: "2009-05-11" },
      validFrom: Date.UTC(2009, 4, 11),
    });
    const corrected = await owner.mutation(
      api.models.facts.mcpActions.remember,
      {
        ...base,
        value: { type: "date", value: "2009-05-12" },
        changeKind: "corrected",
      },
    );

    expect(corrected.operation).toBe("corrected");
    const prior = await t.run((ctx) => ctx.db.get(wrong.factId));
    expect(prior?.status).toBe("retracted");
    expect(prior?.validFrom).toBeUndefined();
    expect(prior?.validTo).toBeUndefined();
  });

  test("keeps MCP and dashboard fact reads isolated by account and issuer", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const owner = t.withIdentity({ issuer, subject: ownerId });
    const other = t.withIdentity({ issuer, subject: otherId });
    await owner.mutation(api.models.facts.mcpActions.remember, {
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
});
