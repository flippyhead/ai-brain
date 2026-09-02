import type { Infer } from "convex/values";
import type { Expression, FilterBuilder, NamedTableInfo } from "convex/server";

import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isMemoryRetrievable,
} from "../thoughts/memoryLifecycle";
import { extractEntityCandidates, normalizeEntityText } from "./entityMatch";
import {
  entityKind,
  entitySelector,
  factSourceType,
  factValueInput,
} from "./validators";

export type EntityKind = Infer<typeof entityKind>;
export type EntitySelector = Infer<typeof entitySelector>;
export type FactValueInput = Infer<typeof factValueInput>;
export type FactSourceType = Infer<typeof factSourceType>;

export const MAX_FACT_SEARCH_LIMIT = 50;
export const DEFAULT_FACT_SEARCH_LIMIT = 10;
const ENTITY_NAME_MAX_CHARS = 200;
const ENTITY_KEY_MAX_CHARS = 160;
const FACT_TEXT_MAX_CHARS = 1_000;
const SOURCE_REF_MAX_CHARS = 500;
const BATCH_ID_MAX_CHARS = 160;
const PREDICATE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DERIVED_OR_SENSITIVE_PREDICATES = new Set([
  "age",
  "current_age",
  "years_old",
  "password",
  "api_key",
  "access_token",
  "refresh_token",
  "secret",
]);

function boundedText(value: string, label: string, maxChars: number): string {
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > maxChars) {
    throw new Error(`${label} must contain 1-${maxChars} characters`);
  }
  return normalized;
}

export function normalizeEntityName(name: string): string {
  return normalizeEntityText(
    boundedText(name, "Entity name", ENTITY_NAME_MAX_CHARS),
  );
}

function slugifyEntityName(name: string): string {
  return normalizeEntityName(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function normalizeEntityKey(
  key: string | undefined,
  kind: EntityKind,
  name: string,
): string {
  const normalized = (key ?? `${kind}:${slugifyEntityName(name)}`)
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  if (
    !normalized ||
    normalized.length > ENTITY_KEY_MAX_CHARS ||
    !/^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    throw new Error(
      "Entity key must look like person:zevin or organization:openai",
    );
  }
  // A generated key always carries its kind. A supplied one has to agree, or
  // the entity is stored under an identity that contradicts its own kind and
  // every later lookup for that key resolves confusingly.
  if (!normalized.startsWith(`${kind}:`)) {
    throw new Error(`Entity key must begin with its kind, like ${kind}:name`);
  }
  return normalized;
}

export function normalizePredicate(predicate: string): string {
  const normalized = predicate.trim().toLocaleLowerCase("en-US");
  if (!PREDICATE_PATTERN.test(normalized)) {
    throw new Error(
      "Predicate must be 2-64 lowercase letters, numbers, or underscores",
    );
  }
  if (DERIVED_OR_SENSITIVE_PREDICATES.has(normalized)) {
    if (["age", "current_age", "years_old"].includes(normalized)) {
      throw new Error(
        "Do not store a derived age. Store date_of_birth only when the exact date was explicitly stated or confirmed.",
      );
    }
    throw new Error("Credentials and secrets must not be stored as facts");
  }
  return normalized;
}

export function normalizeIsoDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) throw new Error("Date facts must use YYYY-MM-DD");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error("Date fact is not a real calendar date");
  }
  return `${yearText}-${monthText}-${dayText}`;
}

function normalizeAliases(
  aliases: string[] | undefined,
  canonicalName: string,
): { aliases: string[]; normalizedAliases: string[] } {
  const byNormalized = new Map<string, string>();
  const canonicalNormalized = normalizeEntityName(canonicalName);
  for (const alias of aliases ?? []) {
    const cleaned = boundedText(alias, "Entity alias", ENTITY_NAME_MAX_CHARS);
    const normalized = normalizeEntityName(cleaned);
    if (normalized !== canonicalNormalized)
      byNormalized.set(normalized, cleaned);
  }
  return {
    aliases: [...byNormalized.values()].slice(0, 20),
    normalizedAliases: [...byNormalized.keys()].slice(0, 20),
  };
}

export async function resolveEntity(
  ctx: MutationCtx,
  userId: Id<"users">,
  selector: EntitySelector,
): Promise<Doc<"entities">> {
  const canonicalName = boundedText(
    selector.name,
    "Entity name",
    ENTITY_NAME_MAX_CHARS,
  );
  const normalizedName = normalizeEntityName(canonicalName);
  const key = normalizeEntityKey(selector.key, selector.kind, canonicalName);
  const incomingAliases = normalizeAliases(selector.aliases, canonicalName);
  const existing = await ctx.db
    .query("entities")
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", userId).eq("key", key),
    )
    .unique();

  if (existing) {
    if (existing.kind !== selector.kind) {
      throw new Error("Entity key is already assigned to a different kind");
    }
    const aliasMap = new Map<string, string>();
    existing.normalizedAliases.forEach((alias, index) =>
      aliasMap.set(alias, existing.aliases[index] ?? alias),
    );
    incomingAliases.normalizedAliases.forEach((alias, index) =>
      aliasMap.set(alias, incomingAliases.aliases[index] ?? alias),
    );
    if (existing.normalizedName !== normalizedName) {
      aliasMap.set(normalizedName, canonicalName);
    }
    const updatedAt = Date.now();
    await ctx.db.patch(existing._id, {
      aliases: [...aliasMap.values()].slice(0, 20),
      normalizedAliases: [...aliasMap.keys()].slice(0, 20),
      updatedAt,
    });
    return (await ctx.db.get(existing._id))!;
  }

  const entityId = await ctx.db.insert("entities", {
    userId,
    key,
    kind: selector.kind,
    canonicalName,
    normalizedName,
    ...incomingAliases,
  });
  return (await ctx.db.get(entityId))!;
}

// Written out so the compiler rejects the list when a kind is added to the
// validator without being added here.
const ENTITY_KINDS = Object.keys({
  person: true,
  organization: true,
  project: true,
  place: true,
  other: true,
} satisfies Record<EntityKind, true>) as EntityKind[];

// Alias matching scans the account's entities because normalizedAliases is an
// array field. Free at tens of entities. Above ~5,000, replace this with an
// entityAliases join table (one indexed row per alias).
const ENTITY_ALIAS_SCAN_LIMIT = 5_000;

export type EntityLookup = { name: string } | { key: string };

export type EntityMention = {
  /** The normalized text that matched, as it appeared among the candidates. */
  mention: string;
  entity: Doc<"entities">;
};

/**
 * Resolves the entities a list of names refers to, in the order the names
 * were given, one row per entity. Reads only.
 *
 * Canonical names go through `by_userId_kind_normalizedName`, one probe per
 * kind; names that miss are then matched against aliases with one bounded
 * scan shared by every miss. A name that matches nothing is simply absent
 * from the result — it is never created.
 */
export async function findEntitiesNamed(
  ctx: QueryCtx,
  userId: Id<"users">,
  names: readonly string[],
): Promise<EntityMention[]> {
  const normalized = [
    ...new Set(
      names
        .map((name) => name.trim())
        .filter(
          (name) =>
            name.length > 0 && Array.from(name).length <= ENTITY_NAME_MAX_CHARS,
        )
        .map(normalizeEntityText)
        .filter((name) => name.length > 0),
    ),
  ];
  if (normalized.length === 0) return [];

  const found = new Map<string, Doc<"entities">>();
  await Promise.all(
    normalized.map(async (name) => {
      const byKind = await Promise.all(
        ENTITY_KINDS.map((kind) =>
          ctx.db
            .query("entities")
            .withIndex("by_userId_kind_normalizedName", (q) =>
              q
                .eq("userId", userId)
                .eq("kind", kind)
                .eq("normalizedName", name),
            )
            .first(),
        ),
      );
      const hit = byKind.find((entity) => entity !== null);
      if (hit) found.set(name, hit);
    }),
  );

  const missing = new Set(normalized.filter((name) => !found.has(name)));
  if (missing.size > 0) {
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(ENTITY_ALIAS_SCAN_LIMIT);
    for (const entity of entities) {
      for (const alias of entity.normalizedAliases) {
        if (missing.has(alias) && !found.has(alias)) found.set(alias, entity);
      }
    }
  }

  const seen = new Set<Id<"entities">>();
  const mentions: EntityMention[] = [];
  for (const name of normalized) {
    const entity = found.get(name);
    if (!entity || seen.has(entity._id)) continue;
    seen.add(entity._id);
    mentions.push({ mention: name, entity });
  }
  return mentions;
}

/**
 * Read-only entity lookup by canonical name, alias, or key, scoped to one
 * account. Returns null on a miss and never writes.
 *
 * This is the read path's resolver. `resolveEntity` is the write path's: it
 * inserts on a miss and patches aliases on a hit, so a read that used it would
 * create an entity for every unrecognised proper noun in a user's message.
 */
export async function findEntity(
  ctx: QueryCtx,
  userId: Id<"users">,
  lookup: EntityLookup,
): Promise<Doc<"entities"> | null> {
  if ("key" in lookup) {
    const key = lookup.key.trim().normalize("NFKC").toLocaleLowerCase("en-US");
    if (!key) return null;
    return await ctx.db
      .query("entities")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .first();
  }
  const [hit] = await findEntitiesNamed(ctx, userId, [lookup.name]);
  return hit?.entity ?? null;
}

function normalizeOptionalText(
  value: string | undefined,
  label: string,
  maxChars: number,
): string | undefined {
  return value === undefined ? undefined : boundedText(value, label, maxChars);
}

async function normalizeFactValue(
  ctx: MutationCtx,
  userId: Id<"users">,
  value: FactValueInput,
): Promise<Doc<"facts">["value"]> {
  switch (value.type) {
    case "text":
      return {
        type: "text",
        value: boundedText(value.value, "Fact value", FACT_TEXT_MAX_CHARS),
      };
    case "date":
      return { type: "date", value: normalizeIsoDate(value.value) };
    case "datetime":
      if (!Number.isFinite(value.value)) {
        throw new Error("Datetime fact must be a finite Unix timestamp");
      }
      return value;
    case "number":
      if (!Number.isFinite(value.value)) {
        throw new Error("Number fact must be finite");
      }
      return {
        ...value,
        unit: normalizeOptionalText(value.unit, "Fact unit", 80),
      };
    case "boolean":
      return value;
    case "entity": {
      const entity = await resolveEntity(ctx, userId, value.entity);
      return { type: "entity", entityId: entity._id };
    }
  }
}

function factValueKey(value: Doc<"facts">["value"]): string {
  switch (value.type) {
    case "entity":
      return `entity:${value.entityId}`;
    case "number":
      return `number:${value.value}:${value.unit ?? ""}`;
    default:
      return `${value.type}:${String(value.value).normalize("NFKC").toLocaleLowerCase("en-US")}`;
  }
}

function displayFactValue(
  value: Doc<"facts">["value"],
  objectEntity: Doc<"entities"> | null,
): string {
  switch (value.type) {
    case "entity":
      return objectEntity?.canonicalName ?? "Unknown entity";
    case "datetime":
      return new Date(value.value).toISOString();
    case "number":
      return `${value.value}${value.unit ? ` ${value.unit}` : ""}`;
    case "boolean":
      return value.value ? "yes" : "no";
    default:
      return value.value;
  }
}

function predicateLabel(predicate: string): string {
  return predicate.replaceAll("_", " ");
}

export function isFactActive(fact: Doc<"facts">, at = Date.now()): boolean {
  return (
    fact.status === "current" &&
    (fact.validFrom === undefined || fact.validFrom <= at) &&
    (fact.validTo === undefined || at < fact.validTo)
  );
}

/**
 * Returns whether a fact may be returned by a read.
 *
 * Structured facts and narrative memories share one retrievability rule, so
 * this adapts the fact shape onto `isMemoryRetrievable` rather than restating
 * it. Keeping two copies is what allowed the same retracted-as-history defect
 * to ship in both paths independently.
 */
export function isFactRetrievable(
  fact: Doc<"facts">,
  includeHistorical: boolean | undefined,
  at = Date.now(),
): boolean {
  return isMemoryRetrievable(
    {
      memoryStatus: fact.status,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
    },
    includeHistorical,
    at,
  );
}

type FactFilterBuilder = FilterBuilder<NamedTableInfo<DataModel, "facts">>;

/**
 * Express current business-time validity inside the Convex query so `take`
 * counts retrievable rows rather than candidates later discarded in memory.
 */
function currentFactValidityFilter(
  q: FactFilterBuilder,
  activeAt: number,
): Expression<boolean> {
  const validFrom = q.field("validFrom");
  const validTo = q.field("validTo");
  return q.and(
    q.or(
      q.eq(validFrom, undefined),
      q.lte(validFrom as Expression<number>, activeAt),
    ),
    q.or(
      q.eq(validTo, undefined),
      q.gt(validTo as Expression<number>, activeAt),
    ),
  );
}

export type RememberFactArgs = {
  subject: EntitySelector;
  predicate: string;
  value: FactValueInput;
  sourceType: FactSourceType;
  sourceRef?: string;
  observedAt?: number;
  batchId?: string;
  isCore?: boolean;
  validFrom?: number;
  validTo?: number;
  cardinality?: "single" | "multiple";
  changeKind?: "changed" | "corrected";
  changeReason?: string;
};

export async function rememberFact(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: RememberFactArgs,
) {
  assertValidMemoryValidity(args);
  if (args.observedAt !== undefined && !Number.isFinite(args.observedAt)) {
    throw new Error("observedAt must be a finite timestamp");
  }
  const subject = await resolveEntity(ctx, userId, args.subject);
  const predicate = normalizePredicate(args.predicate);
  if (predicate === "date_of_birth" && args.value.type !== "date") {
    throw new Error("date_of_birth must use an exact date value");
  }
  const value = await normalizeFactValue(ctx, userId, args.value);
  const objectEntity =
    value.type === "entity" ? await ctx.db.get(value.entityId) : null;
  if (objectEntity && objectEntity.userId !== userId) {
    throw new Error("Fact value entity is unavailable");
  }
  const displayedValue = displayFactValue(value, objectEntity);
  const statement = `${subject.canonicalName} — ${predicateLabel(predicate)}: ${displayedValue}.`;
  const searchText = [
    subject.key,
    subject.canonicalName,
    ...subject.aliases,
    predicate,
    predicateLabel(predicate),
    displayedValue,
    objectEntity?.key,
    ...(objectEntity?.aliases ?? []),
  ]
    .filter((item): item is string => Boolean(item))
    .join(" ");
  const sourceRef = normalizeOptionalText(
    args.sourceRef,
    "Source reference",
    SOURCE_REF_MAX_CHARS,
  );
  const batchId = normalizeOptionalText(
    args.batchId,
    "Batch id",
    BATCH_ID_MAX_CHARS,
  );
  const changeReason = normalizeOptionalText(
    args.changeReason,
    "Change reason",
    500,
  );

  const current = await ctx.db
    .query("facts")
    .withIndex("by_userId_subject_predicate_status", (q) =>
      q
        .eq("userId", userId)
        .eq("subjectEntityId", subject._id)
        .eq("predicate", predicate)
        .eq("status", "current"),
    )
    .collect();
  const valueKey = factValueKey(value);
  const duplicate = current.find(
    (fact) =>
      factValueKey(fact.value) === valueKey &&
      (isFactActive(fact) ||
        (fact.validFrom === args.validFrom && fact.validTo === args.validTo)),
  );
  if (duplicate) {
    await ctx.db.patch(duplicate._id, {
      isCore: args.isCore ?? duplicate.isCore,
      sourceType: args.sourceType,
      sourceRef: sourceRef ?? duplicate.sourceRef,
      observedAt: args.observedAt ?? duplicate.observedAt,
      batchId: batchId ?? duplicate.batchId,
      confidence: 1,
      statement,
      searchText,
      updatedAt: Date.now(),
    });
    return {
      factId: duplicate._id,
      statement,
      operation: "noop" as const,
    };
  }

  const affected = (args.cardinality ?? "single") === "single" ? current : [];
  const now = Date.now();
  const factId = await ctx.db.insert("facts", {
    userId,
    subjectEntityId: subject._id,
    predicate,
    value,
    statement,
    searchText,
    sourceType: args.sourceType,
    sourceRef,
    observedAt: args.observedAt,
    batchId,
    confidence: 1,
    isCore: args.isCore,
    validFrom: args.validFrom,
    validTo: args.validTo,
    status: "current",
    supersedes:
      affected.length > 0 ? affected.map((fact) => fact._id) : undefined,
    changeReason,
  });

  for (const prior of affected) {
    const corrected = args.changeKind === "corrected";
    const validTo =
      !corrected &&
      args.validFrom !== undefined &&
      prior.validTo === undefined &&
      (prior.validFrom === undefined || prior.validFrom < args.validFrom)
        ? args.validFrom
        : prior.validTo;
    await ctx.db.patch(prior._id, {
      status: corrected ? "retracted" : "superseded",
      supersededAt: now,
      supersededBy: factId,
      changeReason:
        changeReason ??
        (corrected ? "Earlier fact was corrected" : "Fact changed"),
      ...(corrected
        ? { validFrom: undefined, validTo: undefined }
        : validTo === undefined
          ? {}
          : { validTo }),
    });
  }

  return {
    factId,
    statement,
    operation:
      affected.length === 0
        ? ("stored" as const)
        : args.changeKind === "corrected"
          ? ("corrected" as const)
          : ("superseded" as const),
  };
}

export async function hydrateFact(ctx: QueryCtx, fact: Doc<"facts">) {
  const [subject, objectEntity] = await Promise.all([
    ctx.db.get(fact.subjectEntityId),
    fact.value.type === "entity" ? ctx.db.get(fact.value.entityId) : null,
  ]);
  return {
    id: fact._id,
    statement: fact.statement,
    subject:
      subject === null
        ? null
        : {
            id: subject._id,
            key: subject.key,
            kind: subject.kind,
            name: subject.canonicalName,
            aliases: subject.aliases,
          },
    predicate: fact.predicate,
    value:
      fact.value.type === "entity"
        ? {
            type: "entity" as const,
            entity:
              objectEntity === null
                ? null
                : {
                    id: objectEntity._id,
                    key: objectEntity.key,
                    kind: objectEntity.kind,
                    name: objectEntity.canonicalName,
                    aliases: objectEntity.aliases,
                  },
          }
        : fact.value,
    sourceType: fact.sourceType,
    sourceRef: fact.sourceRef,
    observedAt: fact.observedAt,
    batchId: fact.batchId,
    confidence: fact.confidence,
    isCore: fact.isCore ?? false,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    status: fact.status,
    supersededAt: fact.supersededAt,
    supersededBy: fact.supersededBy,
    supersedes: fact.supersedes,
    changeReason: fact.changeReason,
    createdAt: fact._creationTime,
    updatedAt: fact.updatedAt,
  };
}

export async function listFacts(
  ctx: QueryCtx,
  userId: Id<"users">,
  options: {
    limit?: number;
    includeHistorical?: boolean;
    coreOnly?: boolean;
  } = {},
) {
  const requested = options.limit ?? DEFAULT_FACT_SEARCH_LIMIT;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Fact limit must be a positive integer");
  }
  const limit = Math.min(requested, MAX_FACT_SEARCH_LIMIT);
  const activeAt = Date.now();
  let selected: Doc<"facts">[];
  if (options.includeHistorical) {
    selected = options.coreOnly
      ? await ctx.db
          .query("facts")
          .withIndex("by_userId_and_isCore", (q) =>
            q.eq("userId", userId).eq("isCore", true),
          )
          .order("desc")
          .filter((q) => q.neq(q.field("status"), "retracted"))
          .take(limit)
      : await ctx.db
          .query("facts")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .order("desc")
          .filter((q) => q.neq(q.field("status"), "retracted"))
          .take(limit);
  } else {
    selected = options.coreOnly
      ? await ctx.db
          .query("facts")
          .withIndex("by_userId_isCore_status", (q) =>
            q.eq("userId", userId).eq("isCore", true).eq("status", "current"),
          )
          .order("desc")
          .filter((q) => currentFactValidityFilter(q, activeAt))
          .take(limit)
      : await ctx.db
          .query("facts")
          .withIndex("by_userId_and_status", (q) =>
            q.eq("userId", userId).eq("status", "current"),
          )
          .order("desc")
          .filter((q) => currentFactValidityFilter(q, activeAt))
          .take(limit);
  }
  return await Promise.all(selected.map((fact) => hydrateFact(ctx, fact)));
}

/** Facts loaded per named entity before ranking; more than this is ignored. */
const EXACT_FACTS_PER_ENTITY = 50;
const RECALL_QUERY_MAX_CHARS = 12_000;

function termsOf(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 2),
  );
}

/**
 * How many of a fact's own terms the query mentions. A prefix counts once
 * both sides are four characters long, so "directly" reaches "direct line"
 * and "payments" reaches "payment". The subject's name is in every one of its
 * facts, so it cannot separate them; the predicate and value can.
 */
function queryOverlap(fact: Doc<"facts">, queryTerms: Set<string>): number {
  let overlap = 0;
  for (const term of termsOf(fact.searchText)) {
    for (const queryTerm of queryTerms) {
      if (
        term === queryTerm ||
        (term.length >= 4 &&
          queryTerm.length >= 4 &&
          (term.startsWith(queryTerm) || queryTerm.startsWith(term)))
      ) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap;
}

export type ExactFactResult = Awaited<ReturnType<typeof hydrateFact>> & {
  /** The entity the query named, and the text it named it by. */
  matchedEntity: { name: string; mention: string };
};

/**
 * Current facts about the entities a query names by exact name or alias.
 *
 * This is the exact tier of `recall_context`: a query that names a known
 * thing gets that thing's facts ahead of whatever ranked highest. Names are
 * extracted without a model call (`extractEntityCandidates`), resolved
 * without writing (`findEntitiesNamed`), and each entity's current facts
 * are ordered by how much of their wording the query mentions, core first
 * among ties, newest last of all. Several named entities share the limit in
 * turn, so one entity with many facts cannot crowd out another.
 *
 * Only current facts are served here, whatever the caller's historical
 * setting: history reaches the window through the relevance tier, as before.
 */
export async function recallExactFacts(
  ctx: QueryCtx,
  userId: Id<"users">,
  query: string,
  options: { limit?: number } = {},
): Promise<ExactFactResult[]> {
  const cleanedQuery = boundedText(
    query,
    "Recall query",
    RECALL_QUERY_MAX_CHARS,
  );
  const requested = options.limit ?? DEFAULT_FACT_SEARCH_LIMIT;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Exact recall limit must be a positive integer");
  }
  const limit = Math.min(requested, MAX_FACT_SEARCH_LIMIT);

  const mentions = await findEntitiesNamed(
    ctx,
    userId,
    extractEntityCandidates(cleanedQuery),
  );
  if (mentions.length === 0) return [];

  const queryTerms = termsOf(cleanedQuery);
  const rankedPerEntity = await Promise.all(
    mentions.map(async ({ mention, entity }) => {
      const facts = await ctx.db
        .query("facts")
        .withIndex("by_userId_subject_predicate_status", (q) =>
          q.eq("userId", userId).eq("subjectEntityId", entity._id),
        )
        .take(EXACT_FACTS_PER_ENTITY);
      return facts
        .filter((fact) => isFactRetrievable(fact, false))
        .map((fact) => ({
          fact,
          overlap: queryOverlap(fact, queryTerms),
          matchedEntity: { name: entity.canonicalName, mention },
        }))
        .sort(
          (a, b) =>
            b.overlap - a.overlap ||
            Number(b.fact.isCore ?? false) - Number(a.fact.isCore ?? false) ||
            b.fact._creationTime - a.fact._creationTime,
        );
    }),
  );

  const selected: (typeof rankedPerEntity)[number] = [];
  for (
    let round = 0;
    selected.length < limit &&
    rankedPerEntity.some((ranked) => round < ranked.length);
    round += 1
  ) {
    for (const ranked of rankedPerEntity) {
      if (selected.length >= limit) break;
      const next = ranked[round];
      if (next) selected.push(next);
    }
  }

  return await Promise.all(
    selected.map(async ({ fact, matchedEntity }) => ({
      ...(await hydrateFact(ctx, fact)),
      matchedEntity,
    })),
  );
}

export async function searchFacts(
  ctx: QueryCtx,
  userId: Id<"users">,
  query: string,
  options: { limit?: number; includeHistorical?: boolean } = {},
) {
  const cleanedQuery = boundedText(query, "Fact search query", 12_000);
  const requested = options.limit ?? DEFAULT_FACT_SEARCH_LIMIT;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Fact search limit must be a positive integer");
  }
  const limit = Math.min(requested, MAX_FACT_SEARCH_LIMIT);
  const activeAt = Date.now();
  const selected = await ctx.db
    .query("facts")
    .withSearchIndex("by_searchText", (q) => {
      const search = q.search("searchText", cleanedQuery).eq("userId", userId);
      return options.includeHistorical
        ? search
        : search.eq("status", "current");
    })
    .filter((q) =>
      options.includeHistorical
        ? q.neq(q.field("status"), "retracted")
        : currentFactValidityFilter(q, activeAt),
    )
    .take(limit);
  return await Promise.all(selected.map((fact) => hydrateFact(ctx, fact)));
}
