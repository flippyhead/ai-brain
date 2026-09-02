import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { liveRecallCorpus } from "../thoughts/memoryEval.corpus";
import {
  recordedBakeoffRankings,
  recordedExactEntityRankings,
} from "../thoughts/memoryEval.fixtures";
import { findEntity, recallExactFacts } from "./model";

type Harness = ReturnType<typeof convexTest>;

async function seedUser(t: Harness): Promise<Id<"users">> {
  return await t.run((ctx) => ctx.db.insert("users", {}));
}

async function remember(
  t: Harness,
  userId: Id<"users">,
  fact: {
    subject: { key?: string; name: string; aliases?: string[] };
    predicate: string;
    value: string;
    isCore?: boolean;
    changeKind?: "changed" | "corrected";
  },
) {
  return await t.run((ctx) =>
    ctx.runMutation(internal.models.facts.private.seedFact, {
      userId,
      subject: { kind: "person", ...fact.subject },
      predicate: fact.predicate,
      value: { type: "text", value: fact.value },
      sourceType: "user_stated",
      isCore: fact.isCore,
      changeKind: fact.changeKind,
    }),
  );
}

async function entityCount(t: Harness): Promise<number> {
  return await t.run(
    async (ctx) => (await ctx.db.query("entities").collect()).length,
  );
}

describe("read-only entity lookup", () => {
  test("finds an entity by canonical name however it is cased or spaced", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: { key: "person:jordan", name: "Jordan Schwartz" },
      predicate: "home_city",
      value: "Fernwood",
    });

    for (const name of [
      "Jordan Schwartz",
      "jordan-schwartz",
      "  JORDAN  schwartz ",
    ]) {
      const entity = await t.run((ctx) => findEntity(ctx, userId, { name }));
      expect(entity?.key).toBe("person:jordan");
    }
  });

  test("finds an entity by alias and by key", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: {
        key: "person:jordan",
        name: "Jordan Schwartz",
        aliases: ["Jordan", "J. Schwartz"],
      },
      predicate: "home_city",
      value: "Fernwood",
    });

    const byAlias = await t.run((ctx) =>
      findEntity(ctx, userId, { name: "jordan" }),
    );
    expect(byAlias?.key).toBe("person:jordan");
    const byKey = await t.run((ctx) =>
      findEntity(ctx, userId, { key: "Person:Jordan" }),
    );
    expect(byKey?.canonicalName).toBe("Jordan Schwartz");
  });

  test("returns null on a miss and creates nothing", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: { key: "person:jordan", name: "Jordan" },
      predicate: "home_city",
      value: "Fernwood",
    });
    const before = await entityCount(t);

    expect(
      await t.run((ctx) => findEntity(ctx, userId, { name: "Nobody Known" })),
    ).toBeNull();
    expect(
      await t.run((ctx) => findEntity(ctx, userId, { key: "person:nobody" })),
    ).toBeNull();
    expect(
      await t.run((ctx) => findEntity(ctx, userId, { name: "   " })),
    ).toBeNull();
    expect(
      await t.run((ctx) => findEntity(ctx, userId, { name: "x".repeat(201) })),
    ).toBeNull();
    expect(await entityCount(t)).toBe(before);
  });

  test("never returns another account's entity", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t);
    const other = await seedUser(t);
    await remember(t, owner, {
      subject: { key: "person:jordan", name: "Jordan", aliases: ["Jo"] },
      predicate: "home_city",
      value: "Fernwood",
    });

    expect(
      await t.run((ctx) => findEntity(ctx, other, { name: "Jordan" })),
    ).toBeNull();
    expect(
      await t.run((ctx) => findEntity(ctx, other, { name: "Jo" })),
    ).toBeNull();
    expect(
      await t.run((ctx) => findEntity(ctx, other, { key: "person:jordan" })),
    ).toBeNull();
    expect(await entityCount(t)).toBe(1);
  });
});

describe("exact facts for a query", () => {
  test("serves the named entity's current facts, best-worded first", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: { key: "person:marisol", name: "Marisol" },
      predicate: "role",
      value: "Delgado Mechanical service coordinator",
    });
    await remember(t, userId, {
      subject: { key: "person:marisol", name: "Marisol" },
      predicate: "direct_line",
      value: "extension 4471",
    });
    await remember(t, userId, {
      subject: { key: "person:priya", name: "Priya" },
      predicate: "role",
      value: "Foster Clarity rollout owner",
    });

    const results = await t.run((ctx) =>
      recallExactFacts(ctx, userId, "How do I reach Marisol directly?", {
        limit: 5,
      }),
    );
    expect(results.map((fact) => fact.predicate)).toEqual([
      "direct_line",
      "role",
    ]);
    expect(results[0]?.matchedEntity).toEqual({
      name: "Marisol",
      mention: "marisol",
    });
  });

  test("shares the limit between several named entities in turn", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    for (const predicate of ["role", "home_city", "time_zone"]) {
      await remember(t, userId, {
        subject: { key: "person:priya", name: "Priya" },
        predicate,
        value: `priya ${predicate}`,
      });
    }
    await remember(t, userId, {
      subject: { key: "person:tomas", name: "Tomas", aliases: ["Tom"] },
      predicate: "role",
      value: "Atlas Memory maintainer",
    });

    const results = await t.run((ctx) =>
      recallExactFacts(ctx, userId, "Are Priya and Tom both in this week?", {
        limit: 3,
      }),
    );
    expect(results).toHaveLength(3);
    expect(results.map((fact) => fact.subject?.name)).toEqual([
      "Priya",
      "Tomas",
      "Priya",
    ]);
    expect(results[1]?.matchedEntity).toEqual({
      name: "Tomas",
      mention: "tom",
    });
  });

  test("serves only current facts, whatever the caller asked about history", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: { key: "person:zevin", name: "Zevin" },
      predicate: "school",
      value: "Lakeside School",
    });
    await remember(t, userId, {
      subject: { key: "person:zevin", name: "Zevin" },
      predicate: "school",
      value: "Redwood Academy",
    });
    await remember(t, userId, {
      subject: { key: "person:zevin", name: "Zevin" },
      predicate: "date_of_birth_recorded",
      value: "wrong",
    });
    await remember(t, userId, {
      subject: { key: "person:zevin", name: "Zevin" },
      predicate: "date_of_birth_recorded",
      value: "right",
      changeKind: "corrected",
    });

    const results = await t.run((ctx) =>
      recallExactFacts(ctx, userId, "How has Zevin's school changed?", {
        limit: 10,
      }),
    );
    expect(results.map((fact) => fact.status)).toEqual(["current", "current"]);
    expect(results.map((fact) => fact.statement)).toEqual([
      "Zevin — school: Redwood Academy.",
      "Zevin — date of birth recorded: right.",
    ]);
  });

  test("returns nothing when the query names no known entity", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await remember(t, userId, {
      subject: { key: "person:zevin", name: "Zevin" },
      predicate: "school",
      value: "Redwood Academy",
    });
    const before = await entityCount(t);

    expect(
      await t.run((ctx) =>
        recallExactFacts(
          ctx,
          userId,
          "Who should I call when the heating stops?",
          {
            limit: 5,
          },
        ),
      ),
    ).toEqual([]);
    expect(
      await t.run((ctx) =>
        recallExactFacts(ctx, userId, "Tell Rowan about Atlas Memory", {
          limit: 5,
        }),
      ),
    ).toEqual([]);
    expect(await entityCount(t)).toBe(before);
  });
});

describe("exact tier on the eval corpus", () => {
  /** Seeds every corpus account's facts and maps stored ids back to keys. */
  async function seedCorpusFacts(t: Harness) {
    const userIdByLabel = new Map<string, Id<"users">>();
    const keyByFactId = new Map<string, string>();
    for (const account of liveRecallCorpus) {
      const userId = await seedUser(t);
      userIdByLabel.set(account.label, userId);
      for (const fact of account.facts ?? []) {
        const result = await remember(t, userId, {
          subject: {
            key: fact.subjectKey,
            name: fact.subjectName,
            aliases: fact.subjectAliases,
          },
          predicate: fact.predicate,
          value: fact.value,
          isCore: fact.isCore,
          changeKind: fact.corrects === undefined ? undefined : "corrected",
        });
        keyByFactId.set(result.factId, fact.key);
      }
    }
    return { userIdByLabel, keyByFactId };
  }

  const queryText = (label: string, name: string) => {
    const query = liveRecallCorpus
      .find((account) => account.label === label)
      ?.queries.find((entry) => entry.name === name);
    if (!query) throw new Error(`No corpus query "${name}" for ${label}`);
    return query.query;
  };

  test("the recorded exact rankings are what the tier serves", async () => {
    const t = convexTest(schema, modules);
    const { userIdByLabel, keyByFactId } = await seedCorpusFacts(t);

    for (const ranking of [
      ...recordedBakeoffRankings,
      ...recordedExactEntityRankings,
    ]) {
      const rows = await t.run((ctx) =>
        ctx.runQuery(internal.models.facts.private.recallFacts, {
          userId: userIdByLabel.get(ranking.account)!,
          query: queryText(ranking.account, ranking.queryName),
        }),
      );
      const exactKeys = rows
        .filter((row) => row.source === "exact")
        .map((row) => keyByFactId.get(row.id) ?? `unseeded:${row.id}`);
      expect({ query: ranking.queryName, exactKeys }).toEqual({
        query: ranking.queryName,
        exactKeys: ranking.exactFactKeys,
      });
    }
  });

  test("a name both accounts know resolves to each account's own entity", async () => {
    const t = convexTest(schema, modules);
    const { userIdByLabel, keyByFactId } = await seedCorpusFacts(t);

    const exactKeysFor = async (label: string, query: string) => {
      const results = await t.run((ctx) =>
        recallExactFacts(ctx, userIdByLabel.get(label)!, query, { limit: 5 }),
      );
      return results.map((fact) => keyByFactId.get(fact.id) ?? "unseeded");
    };
    expect(
      await exactKeysFor("avery", "Where does Zevin go to school now?"),
    ).toEqual(["fact-school"]);
    expect(
      await exactKeysFor("rowan", "Where does Zevin go to school?"),
    ).toEqual(["rowan-fact-school"]);
    // Rowan has no Marisol; Avery's must not answer for him.
    expect(
      await exactKeysFor("rowan", "How do I reach Marisol directly?"),
    ).toEqual([]);
  });
});
