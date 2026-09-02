import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import type { DataModel } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../test.setup";

const issuer = "https://brain.example.test";

/** What `t.withIdentity(...)` returns: a client acting as one account. */
type TestClient = TestConvexForDataModel<DataModel>;

/** Jordan's primary care provider changed from Dr. Old to Dr. New. */
async function seedProviderChange(owner: TestClient) {
  const base = {
    subject: { key: "person:jordan", kind: "person" as const, name: "Jordan" },
    predicate: "primary_care_provider",
    sourceType: "user_stated" as const,
  };
  const oldFact = await owner.action(api.models.facts.mcpActions.remember, {
    ...base,
    value: {
      type: "entity",
      entity: { key: "person:dr-old", kind: "person", name: "Dr. Old" },
    },
    validFrom: Date.UTC(2020, 0, 1),
  });
  const newFact = await owner.action(api.models.facts.mcpActions.remember, {
    ...base,
    value: {
      type: "entity",
      entity: { key: "person:dr-new", kind: "person", name: "Dr. New" },
    },
    validFrom: Date.UTC(2026, 7, 1),
    changeKind: "changed",
  });
  return { oldFactId: oldFact.factId, newFactId: newFact.factId };
}

describe("forgetting facts and entities", () => {
  const originalIssuer = process.env.MCP_JWT_ISSUER;

  beforeEach(() => {
    process.env.MCP_JWT_ISSUER = issuer;
  });

  afterEach(() => {
    if (originalIssuer === undefined) delete process.env.MCP_JWT_ISSUER;
    else process.env.MCP_JWT_ISSUER = originalIssuer;
  });

  async function seed() {
    const t = convexTest(schema, modules);
    const [ownerId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    return {
      t,
      ownerId,
      otherId,
      owner: t.withIdentity({ issuer, subject: ownerId }),
      other: t.withIdentity({ issuer, subject: otherId }),
    };
  }

  describe("forget_fact", () => {
    test("deletes the current fact and detaches its predecessor without reviving it", async () => {
      const { t, owner } = await seed();
      const { oldFactId, newFactId } = await seedProviderChange(owner);

      const result = await owner.mutation(api.models.facts.mcpActions.forget, {
        factId: newFactId,
        reason: "Dr. New is a third party's provider, not Jordan's",
      });

      expect(result).toEqual({
        factId: newFactId,
        reason: "Dr. New is a third party's provider, not Jordan's",
        detachedPredecessors: [oldFactId],
        detachedSuccessor: undefined,
      });
      expect(await t.run((ctx) => ctx.db.get(newFactId))).toBeNull();
      const old = await t.run((ctx) => ctx.db.get(oldFactId));
      // Still superseded: forgetting the change is not an undo of it.
      expect(old?.status).toBe("superseded");
      expect(old?.supersededBy).toBeUndefined();
      // The entities stay: they are identities, not claims.
      const entities = await t.run((ctx) => ctx.db.query("entities").collect());
      expect(entities.map((entity) => entity.key).sort()).toEqual([
        "person:dr-new",
        "person:dr-old",
        "person:jordan",
      ]);
    });

    test("deletes a superseded fact and drops it from the successor's supersedes", async () => {
      const { t, owner } = await seed();
      const { oldFactId, newFactId } = await seedProviderChange(owner);

      const result = await owner.mutation(api.models.facts.mcpActions.forget, {
        factId: oldFactId,
        reason: "Never should have been recorded",
      });

      expect(result.detachedSuccessor).toBe(newFactId);
      expect(result.detachedPredecessors).toEqual([]);
      const current = await t.run((ctx) => ctx.db.get(newFactId));
      expect(current?.status).toBe("current");
      expect(current?.supersedes).toBeUndefined();
      expect(await t.run((ctx) => ctx.db.get(oldFactId))).toBeNull();
    });

    test("refuses another account's fact and leaves it untouched", async () => {
      const { t, owner, other } = await seed();
      const { newFactId } = await seedProviderChange(owner);
      const before = await t.run((ctx) => ctx.db.get(newFactId));

      await expect(
        other.mutation(api.models.facts.mcpActions.forget, {
          factId: newFactId,
          reason: "Cross-account delete attempt",
        }),
      ).rejects.toThrow("Fact not found");

      expect(await t.run((ctx) => ctx.db.get(newFactId))).toEqual(before);
    });

    test("reports not found for an already-forgotten fact and requires a reason", async () => {
      const { t, owner } = await seed();
      const { newFactId } = await seedProviderChange(owner);

      await expect(
        owner.mutation(api.models.facts.mcpActions.forget, {
          factId: newFactId,
          reason: " ",
        }),
      ).rejects.toThrow("requires a reason");
      expect(await t.run((ctx) => ctx.db.get(newFactId))).not.toBeNull();

      await owner.mutation(api.models.facts.mcpActions.forget, {
        factId: newFactId,
        reason: "First call",
      });
      await expect(
        owner.mutation(api.models.facts.mcpActions.forget, {
          factId: newFactId,
          reason: "Second call",
        }),
      ).rejects.toThrow("Fact not found");
    });
  });

  describe("forget_entity", () => {
    test("cascades to the entity's own facts and to facts that point at it", async () => {
      const { t, owner } = await seed();
      const { oldFactId, newFactId } = await seedProviderChange(owner);
      // A fact about Dr. Old, and one about Jordan that must survive.
      const drOldClinic = await owner.action(
        api.models.facts.mcpActions.remember,
        {
          subject: { key: "person:dr-old", kind: "person", name: "Dr. Old" },
          predicate: "clinic",
          value: { type: "text", value: "Northside Clinic" },
          sourceType: "user_stated",
        },
      );
      const jordanCity = await owner.action(
        api.models.facts.mcpActions.remember,
        {
          subject: { key: "person:jordan", kind: "person", name: "Jordan" },
          predicate: "home_city",
          value: { type: "text", value: "Seattle" },
          sourceType: "user_stated",
        },
      );
      const drOld = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .filter((q) => q.eq(q.field("key"), "person:dr-old"))
          .unique(),
      );
      const jordan = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .filter((q) => q.eq(q.field("key"), "person:jordan"))
          .unique(),
      );

      const result = await owner.mutation(
        api.models.facts.mcpActions.forgetEntityWithFacts,
        {
          entityId: drOld!._id,
          reason: "Dr. Old is a third party who never consented to be stored",
        },
      );

      expect(result).toMatchObject({
        done: true,
        entityId: drOld!._id,
        key: "person:dr-old",
        reason: "Dr. Old is a third party who never consented to be stored",
        deletedSubjectFactIds: [drOldClinic.factId],
        deletedReferencingFacts: [
          {
            factId: oldFactId,
            subjectEntityId: jordan!._id,
            predicate: "primary_care_provider",
          },
        ],
        detachedPredecessors: [],
        detachedSuccessors: [newFactId],
      });

      expect(await t.run((ctx) => ctx.db.get(drOld!._id))).toBeNull();
      expect(await t.run((ctx) => ctx.db.get(drOldClinic.factId))).toBeNull();
      // The referencing fact is deleted, not detached: its statement and
      // search text carry the forgotten name.
      expect(await t.run((ctx) => ctx.db.get(oldFactId))).toBeNull();
      const current = await t.run((ctx) => ctx.db.get(newFactId));
      expect(current?.status).toBe("current");
      expect(current?.supersedes).toBeUndefined();
      expect(await t.run((ctx) => ctx.db.get(jordanCity.factId))).toMatchObject(
        { status: "current" },
      );

      // Nothing searchable mentions the forgotten entity any more, even in
      // history.
      const history = await owner.query(api.models.facts.mcpQueries.search, {
        query: "Dr. Old Northside Clinic",
        includeHistorical: true,
      });
      expect(history.every((fact) => !fact.statement.includes("Dr. Old"))).toBe(
        true,
      );
    });

    test("keeps another account's same-keyed entity and facts intact", async () => {
      const { t, ownerId, otherId, owner, other } = await seed();
      await seedProviderChange(owner);
      await seedProviderChange(other);
      const ownerJordan = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .withIndex("by_userId_and_key", (q) =>
            q.eq("userId", ownerId).eq("key", "person:jordan"),
          )
          .unique(),
      );
      const otherFactsBefore = await t.run((ctx) =>
        ctx.db
          .query("facts")
          .withIndex("by_userId", (q) => q.eq("userId", otherId))
          .collect(),
      );

      // The other account cannot reach the owner's entity by id.
      await expect(
        other.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
          entityId: ownerJordan!._id,
          reason: "Cross-account delete attempt",
        }),
      ).rejects.toThrow("Entity not found");
      expect(await t.run((ctx) => ctx.db.get(ownerJordan!._id))).not.toBeNull();

      // The owner forgetting Jordan removes only the owner's rows.
      const result = await owner.mutation(
        api.models.facts.mcpActions.forgetEntityWithFacts,
        { entityId: ownerJordan!._id, reason: "Wrong person entirely" },
      );
      expect(result.deletedSubjectFactIds).toHaveLength(2);
      expect(result.deletedReferencingFacts).toEqual([]);
      const ownerFacts = await t.run((ctx) =>
        ctx.db
          .query("facts")
          .withIndex("by_userId", (q) => q.eq("userId", ownerId))
          .collect(),
      );
      expect(ownerFacts).toEqual([]);
      const otherFactsAfter = await t.run((ctx) =>
        ctx.db
          .query("facts")
          .withIndex("by_userId", (q) => q.eq("userId", otherId))
          .collect(),
      );
      expect(otherFactsAfter).toEqual(otherFactsBefore);
      const otherEntities = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .withIndex("by_userId", (q) => q.eq("userId", otherId))
          .collect(),
      );
      expect(otherEntities).toHaveLength(3);
    });

    test("deletes in bounded batches and removes the entity only in the last one", async () => {
      const { t, owner } = await seed();
      const zevin = {
        key: "person:zevin",
        kind: "person" as const,
        name: "Zevin",
      };
      // Three facts about Zevin and two facts on other subjects pointing at
      // Zevin: five rows, so a batch of two needs three calls.
      for (const [predicate, value] of [
        ["home_city", "Seattle"],
        ["school", "Redwood Academy"],
        ["favorite_color", "green"],
      ] as const) {
        await owner.action(api.models.facts.mcpActions.remember, {
          subject: zevin,
          predicate,
          value: { type: "text", value },
          sourceType: "user_stated",
        });
      }
      for (const parent of ["Jordan", "Sam"]) {
        await owner.action(api.models.facts.mcpActions.remember, {
          subject: { kind: "person", name: parent },
          predicate: "child",
          value: { type: "entity", entity: zevin },
          sourceType: "user_stated",
          cardinality: "multiple",
        });
      }
      const entity = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .filter((q) => q.eq(q.field("key"), "person:zevin"))
          .unique(),
      );
      const factCount = () =>
        t.run(async (ctx) => (await ctx.db.query("facts").collect()).length);
      expect(await factCount()).toBe(5);

      const calls: Array<{ done: boolean; deleted: number }> = [];
      for (let i = 0; i < 3; i += 1) {
        const result = await owner.mutation(
          api.models.facts.mcpActions.forgetEntityWithFacts,
          { entityId: entity!._id, reason: "Wrong person", batchSize: 2 },
        );
        calls.push({
          done: result.done,
          deleted:
            result.deletedSubjectFactIds.length +
            result.deletedReferencingFacts.length,
        });
        // The entity row stays until the final batch, so an interrupted run
        // is resumable by calling again with the same id.
        expect((await t.run((ctx) => ctx.db.get(entity!._id))) === null).toBe(
          result.done,
        );
      }
      expect(calls).toEqual([
        { done: false, deleted: 2 },
        { done: false, deleted: 2 },
        { done: true, deleted: 1 },
      ]);
      expect(await factCount()).toBe(0);
      // Jordan and Sam keep their identities; only the facts pointing at
      // Zevin went.
      const keys = await t.run(async (ctx) =>
        (await ctx.db.query("entities").collect()).map((row) => row.key).sort(),
      );
      expect(keys).toEqual(["person:jordan", "person:sam"]);
      await expect(
        owner.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
          entityId: entity!._id,
          reason: "Again",
        }),
      ).rejects.toThrow("Entity not found");
      await expect(
        owner.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
          entityId: entity!._id,
          reason: "Bad batch",
          batchSize: 0,
        }),
      ).rejects.toThrow("Entity not found");
    });

    test("rejects a batch size outside 1-100 before deleting anything", async () => {
      const { t, owner } = await seed();
      await seedProviderChange(owner);
      const drNew = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .filter((q) => q.eq(q.field("key"), "person:dr-new"))
          .unique(),
      );
      for (const batchSize of [0, 101, 1.5]) {
        await expect(
          owner.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
            entityId: drNew!._id,
            reason: "Bad batch",
            batchSize,
          }),
        ).rejects.toThrow("batch size");
      }
      expect(await t.run((ctx) => ctx.db.get(drNew!._id))).not.toBeNull();
      expect(
        await t.run(
          async (ctx) => (await ctx.db.query("facts").collect()).length,
        ),
      ).toBe(2);
    });

    test("reports not found for an already-forgotten entity", async () => {
      const { t, owner } = await seed();
      await seedProviderChange(owner);
      const drNew = await t.run((ctx) =>
        ctx.db
          .query("entities")
          .filter((q) => q.eq(q.field("key"), "person:dr-new"))
          .unique(),
      );

      await owner.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
        entityId: drNew!._id,
        reason: "First call",
      });
      await expect(
        owner.mutation(api.models.facts.mcpActions.forgetEntityWithFacts, {
          entityId: drNew!._id,
          reason: "Second call",
        }),
      ).rejects.toThrow("Entity not found");
    });
  });
});
