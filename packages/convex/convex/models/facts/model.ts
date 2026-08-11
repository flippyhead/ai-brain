import type { Infer } from "convex/values";

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { assertValidMemoryValidity } from "../thoughts/memoryLifecycle";
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
  return boundedText(name, "Entity name", ENTITY_NAME_MAX_CHARS)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/g, " ")
    .trim();
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
  const facts = options.coreOnly
    ? await ctx.db
        .query("facts")
        .withIndex("by_userId_and_isCore", (q) =>
          q.eq("userId", userId).eq("isCore", true),
        )
        .order("desc")
        .take(limit * 5)
    : await ctx.db
        .query("facts")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit * 5);
  const selected = facts
    .filter((fact) => options.includeHistorical || isFactActive(fact))
    .slice(0, limit);
  return await Promise.all(selected.map((fact) => hydrateFact(ctx, fact)));
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
  const hits = await ctx.db
    .query("facts")
    .withSearchIndex("by_searchText", (q) =>
      q.search("searchText", cleanedQuery).eq("userId", userId),
    )
    .take(limit * 5);
  const selected = hits
    .filter((fact) => options.includeHistorical || isFactActive(fact))
    .slice(0, limit);
  return await Promise.all(selected.map((fact) => hydrateFact(ctx, fact)));
}
