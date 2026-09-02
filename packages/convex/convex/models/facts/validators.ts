import { v } from "convex/values";

export const entityKind = v.union(
  v.literal("person"),
  v.literal("organization"),
  v.literal("project"),
  v.literal("place"),
  v.literal("other"),
);

export const entitySelector = v.object({
  key: v.optional(v.string()),
  kind: entityKind,
  name: v.string(),
  aliases: v.optional(v.array(v.string())),
});

export const factValueInput = v.union(
  v.object({ type: v.literal("text"), value: v.string() }),
  v.object({ type: v.literal("date"), value: v.string() }),
  v.object({ type: v.literal("datetime"), value: v.number() }),
  v.object({
    type: v.literal("number"),
    value: v.number(),
    unit: v.optional(v.string()),
  }),
  v.object({ type: v.literal("boolean"), value: v.boolean() }),
  v.object({ type: v.literal("entity"), entity: entitySelector }),
);

export const factSourceType = v.union(
  v.literal("user_stated"),
  v.literal("user_confirmed"),
);

/** Arguments of a fact write, shared by the MCP action and internal callers. */
export const rememberFactArgs = {
  subject: entitySelector,
  predicate: v.string(),
  value: factValueInput,
  sourceType: factSourceType,
  sourceRef: v.optional(v.string()),
  observedAt: v.optional(v.number()),
  batchId: v.optional(v.string()),
  isCore: v.optional(v.boolean()),
  validFrom: v.optional(v.number()),
  validTo: v.optional(v.number()),
  cardinality: v.optional(v.union(v.literal("single"), v.literal("multiple"))),
  changeKind: v.optional(v.union(v.literal("changed"), v.literal("corrected"))),
  changeReason: v.optional(v.string()),
};

export const factOperation = v.union(
  v.literal("stored"),
  v.literal("noop"),
  v.literal("superseded"),
  v.literal("corrected"),
);

export const factValue = v.union(
  v.object({ type: v.literal("text"), value: v.string() }),
  v.object({ type: v.literal("date"), value: v.string() }),
  v.object({ type: v.literal("datetime"), value: v.number() }),
  v.object({
    type: v.literal("number"),
    value: v.number(),
    unit: v.optional(v.string()),
  }),
  v.object({ type: v.literal("boolean"), value: v.boolean() }),
  v.object({ type: v.literal("entity"), entityId: v.id("entities") }),
);

export const factStatus = v.union(
  v.literal("current"),
  v.literal("superseded"),
  v.literal("retracted"),
);

export const entityFields = {
  userId: v.id("users"),
  key: v.string(),
  kind: entityKind,
  canonicalName: v.string(),
  normalizedName: v.string(),
  aliases: v.array(v.string()),
  normalizedAliases: v.array(v.string()),
  updatedAt: v.optional(v.number()),
};

export const factFields = {
  userId: v.id("users"),
  subjectEntityId: v.id("entities"),
  predicate: v.string(),
  value: factValue,
  statement: v.string(),
  searchText: v.string(),
  /**
   * Embedding of `searchText`. Optional: facts written before semantic recall
   * existed have none until the backfill runs, and a fact written while the
   * embedding provider is down is stored without one rather than lost.
   */
  embedding: v.optional(v.array(v.float64())),
  sourceType: factSourceType,
  sourceRef: v.optional(v.string()),
  observedAt: v.optional(v.number()),
  batchId: v.optional(v.string()),
  confidence: v.number(),
  isCore: v.optional(v.boolean()),
  validFrom: v.optional(v.number()),
  validTo: v.optional(v.number()),
  /**
   * How the write path treated this fact's subject and predicate: `single`
   * supersedes any prior current value, `multiple` lets values coexist.
   * Absent on facts stored before it was recorded.
   */
  cardinality: v.optional(v.union(v.literal("single"), v.literal("multiple"))),
  status: factStatus,
  supersededAt: v.optional(v.number()),
  supersededBy: v.optional(v.id("facts")),
  supersedes: v.optional(v.array(v.id("facts"))),
  changeReason: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
};
