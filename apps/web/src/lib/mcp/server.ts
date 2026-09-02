import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "@repo/db/convex/_generated/api";
import {
  blendRecallContext,
  coreLimitFor,
} from "@repo/db/convex/models/recallBlend";
import {
  computeRecallGaps,
  fitRecallGapBlocks,
} from "@repo/db/convex/models/recallGaps";
import {
  DEFAULT_CORE_MEMORY_LIMIT,
  MAX_CORE_MEMORY_LIMIT,
} from "@repo/db/convex/models/thoughts/model";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import {
  MCP_TOOL_ANNOTATIONS,
  type McpToolName,
  resolveEnabledMcpToolNames,
} from "@/lib/mcp/tool-policy";
import { MCP_TOOL_NAME_LIST, MCP_TOOL_NAMES } from "@/lib/mcp/tools";

export const SERVER_INSTRUCTIONS = `AI Brain is durable personal memory with two storage forms: precise structured facts and narrative thoughts.

Recall: At the start of a turn that could benefit from personal, relationship, project, preference, decision, or commitment context, call recall_context with query set to the user's complete current message verbatim before answering. Do not paraphrase the query: exact names, capitalization, identifiers, project names, and version strings improve retrieval. Current facts and memories are authoritative by default. Include historical records only when the user asks what used to be true, how something changed, or for a history/timeline.

Capture precise facts: Use remember_fact automatically for one independently changeable subject-predicate-value fact explicitly stated by the user: names, relationships, exact dates, providers, schools, employers, locations, stable preferences, and other scalar or relational knowledge. Never store a derived age; store date_of_birth only when the exact date was explicitly stated or confirmed. Use an entity value for relationships such as primary_care_provider. Use sourceType user_stated for facts stated in the current conversation and user_confirmed only after the user approves a proposed import. Never submit connector observations, email/calendar activity, assistant guesses, or inferences directly to remember_fact. For changed single-valued facts, set validFrom only when known and let the server preserve the old value as history. Use changeKind corrected, not changed, when the former value was inaccurate.

Capture narrative memory: Use capture_thought automatically for a single durable decision with rationale, project state, commitment, or recurring working pattern that does not fit a precise fact. One thought must cover one subject and one coherent unit whose parts would change together. Do not create biographies, dossiers, activity logs, completed-task catalogs, or multi-person/multi-project buckets. Do not wait for an explicit "remember this" request. Preserve exact proper nouns, capitalization, identifiers, project names, and version strings from the user. Never turn assistant suggestions, guesses, deductions, unconfirmed implications, or incidental connector mentions into user memory. If an assistant commitment is worth saving, attribute it explicitly as an assistant commitment. Mark isCore true only for the small set of enduring identity facts, constraints, and preferences useful across many conversations; omit it for ordinary durable memories. Do not capture transient small talk, speculative ideas presented only for discussion, passwords, authentication tokens, or other credentials. Routine successful captures can remain unobtrusive.

Admission: Direct, explicit user statements may be stored automatically when durable. Information found in email, calendars, Slack, GitHub, files, or other connectors is only a candidate: present a small atomic preview and obtain user confirmation before storage. Skip single mentions, inferred relationships, vendor/company lists, completed work, and derived values. If uncertain whether a candidate is explicit, durable, atomic, or useful later, ask rather than store.

Correction: Distinguish wrong from outdated. Information that changed is corrected by capturing the current state, which retires the old memory as linked history. Use retract_thought only when the user says a memory is wrong — it was never true — and pass their reason. Never retract to tidy up memories that merely went stale, and never retract on your own judgement. A retraction keeps the memory and is reversible with restore_thought until a replacement exists.

Forgetting: Retract when it was wrong; forget when it must not remain in storage. Use forget_thought, forget_fact, or forget_entity only when the user asks for something to be erased regardless of whether it was true, such as a mis-captured credential or a third party's private detail. Forgetting is a permanent delete with no undo: the record is removed rather than marked, and forget_entity also removes every fact about or pointing at that entity. Never forget on your own judgement, and never forget to correct or tidy.

This server cannot observe conversations or force tool calls; recall and capture remain client-mediated.`;

const ISO_VALIDITY_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/;
const MAX_CAPTURE_CONTENT_CHARS = 2_000;

// Mirrors `thoughtType` in packages/convex/convex/models/thoughts/validators.ts.
// `procedural` is how-to steps, playbooks, and recurring working patterns.
const THOUGHT_TYPE_VALUES = [
  "decision",
  "person_note",
  "idea",
  "meeting_note",
  "task",
  "reference",
  "procedural",
] as const;
const THOUGHT_TYPE_FILTER_DESCRIPTION =
  "Optional type filter. procedural covers how-to steps, playbooks, and recurring working patterns; reference is stable background information.";

/** Parse an explicit real-world validity date without using the server's timezone. */
export function parseValidityTimestamp(value: string): number {
  const match = ISO_VALIDITY_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      "Use an ISO-8601 date or timezone-qualified datetime (for example, 2026-08-10 or 2026-08-10T15:30:00-07:00)",
    );
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw new Error("Validity date is not a real calendar date");
  }

  if (hourText === undefined) {
    return calendarCheck.getTime();
  }

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error("Validity datetime contains an invalid time");
  }
  if (!zone) {
    throw new Error("Validity datetime must include a UTC offset");
  }
  if (zone !== "Z") {
    const [offsetHourText, offsetMinuteText] = zone.slice(1).split(":");
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      throw new Error("Validity datetime contains an invalid UTC offset");
    }
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Validity datetime is invalid");
  }
  return timestamp;
}

export function parseValidityWindow(
  validFrom?: string,
  validTo?: string,
): { validFrom?: number; validTo?: number } {
  const parsedFrom = validFrom ? parseValidityTimestamp(validFrom) : undefined;
  const parsedTo = validTo ? parseValidityTimestamp(validTo) : undefined;
  if (
    parsedFrom !== undefined &&
    parsedTo !== undefined &&
    parsedFrom >= parsedTo
  ) {
    throw new Error("validFrom must be earlier than validTo");
  }
  return { validFrom: parsedFrom, validTo: parsedTo };
}

const validityTimestampSchema = z.string().refine(
  (value) => {
    try {
      parseValidityTimestamp(value);
      return true;
    } catch {
      return false;
    }
  },
  {
    message:
      "Use an ISO-8601 date or timezone-qualified datetime, not a relative or inferred date",
  },
);

const factDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an exact YYYY-MM-DD date")
  .refine(
    (value) => {
      try {
        parseValidityTimestamp(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Use a real calendar date" },
  );

const entitySelectorSchema = z.object({
  key: z
    .string()
    .max(160)
    .optional()
    .describe(
      "Stable lowercase identity key such as person:zevin. Reuse the same key across facts about this entity.",
    ),
  kind: z.enum(["person", "organization", "project", "place", "other"]),
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

const factValueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    value: z.string().trim().min(1).max(1000),
  }),
  z.object({ type: z.literal("date"), value: factDateSchema }),
  z.object({
    type: z.literal("datetime"),
    value: validityTimestampSchema.describe(
      "Exact ISO-8601 timezone-qualified datetime",
    ),
  }),
  z.object({
    type: z.literal("number"),
    value: z.number().finite(),
    unit: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("entity"), entity: entitySelectorSchema }),
]);

type FactResult = {
  id: string;
  statement: string;
  subject: {
    id: string;
    key: string;
    kind: string;
    name: string;
    aliases: string[];
  } | null;
  predicate: string;
  value: unknown;
  sourceType: "user_stated" | "user_confirmed";
  sourceRef?: string;
  observedAt?: number;
  batchId?: string;
  confidence: number;
  isCore: boolean;
  validFrom?: number;
  validTo?: number;
  cardinality?: "single" | "multiple";
  status: "current" | "superseded" | "retracted";
  supersededAt?: number;
  supersededBy?: string;
  supersedes?: string[];
  changeReason?: string;
  createdAt: number;
  updatedAt?: number;
};

function isDatetimeFactValue(
  value: unknown,
): value is { type: "datetime"; value: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "datetime" &&
    typeof (value as { value?: unknown }).value === "number"
  );
}

function formatFactForMcp(fact: FactResult) {
  return {
    ...fact,
    citation: `fact:${fact.id}`,
    // remember_fact takes datetime values as ISO-8601 but stores milliseconds.
    // Returning the raw number would hand a client a value its own write schema
    // rejects, so the boundary stays ISO in both directions.
    value: isDatetimeFactValue(fact.value)
      ? { ...fact.value, value: new Date(fact.value.value).toISOString() }
      : fact.value,
    observedAt:
      fact.observedAt === undefined
        ? undefined
        : new Date(fact.observedAt).toISOString(),
    validFrom:
      fact.validFrom === undefined
        ? undefined
        : new Date(fact.validFrom).toISOString(),
    validTo:
      fact.validTo === undefined
        ? undefined
        : new Date(fact.validTo).toISOString(),
    supersededAt:
      fact.supersededAt === undefined
        ? undefined
        : new Date(fact.supersededAt).toISOString(),
    createdAt: new Date(fact.createdAt).toISOString(),
    updatedAt:
      fact.updatedAt === undefined
        ? undefined
        : new Date(fact.updatedAt).toISOString(),
  };
}

/** The host's hard limit on a `recall_context` result, declared in `_meta`. */
const RECALL_RESULT_SIZE_CHARS = 50_000;

function truncateContext(content: string, maxChars = 4_000): string {
  const chars = Array.from(content);
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join("")}…`
    : content;
}

/** A hydrated core memory row as `thoughts.mcpQueries.listCore` returns it. */
type CoreThought = {
  _id: string;
  _creationTime: number;
  content: string;
  metadata: {
    type: string;
    topics: string[];
    people: string[];
    actionItems: string[];
    summary: string;
  };
  userId: string;
  updatedAt?: number;
  memoryStatus?: "current" | "superseded" | "retracted";
  isCore?: boolean;
  validFrom?: number;
  validTo?: number;
  supersededAt?: number;
  supersededBy?: string;
  supersedes?: string[];
  changeReason?: string;
};

function formatCoreThoughtForMcp(thought: CoreThought) {
  return {
    id: thought._id,
    citation: `thought:${thought._id}`,
    content: truncateContext(thought.content),
    metadata: thought.metadata,
    memoryKind: "thought" as const,
    source: "core" as const,
    memoryStatus: thought.memoryStatus ?? "current",
    isCore: true,
    validFrom:
      thought.validFrom !== undefined
        ? new Date(thought.validFrom).toISOString()
        : undefined,
    validTo:
      thought.validTo !== undefined
        ? new Date(thought.validTo).toISOString()
        : undefined,
    createdAt: new Date(thought._creationTime).toISOString(),
  };
}

/**
 * list_core_memories advertises this result budget to clients, so it has to
 * hold it: at MAX_CORE_MEMORY_LIMIT the truncated contents alone can exceed it.
 */
const LIST_CORE_MEMORIES_RESULT_BUDGET_CHARS = 50_000;

/**
 * Serialize the core payload within the budget by dropping trailing memories,
 * then trailing facts. Both lists arrive newest-first, so what survives is the
 * most recent core context, and the output is always complete JSON.
 */
export function serializeCoreMemoriesWithinBudget(
  coreFacts: readonly unknown[],
  coreMemories: readonly unknown[],
  budgetChars: number,
): string {
  const facts = [...coreFacts];
  const memories = [...coreMemories];
  for (;;) {
    const text = JSON.stringify(
      {
        coreFacts: facts,
        coreMemories: memories,
        truncated:
          facts.length < coreFacts.length ||
          memories.length < coreMemories.length,
      },
      null,
      2,
    );
    if (text.length <= budgetChars) return text;
    if (memories.length > 0) memories.pop();
    else if (facts.length > 0) facts.pop();
    else return text;
  }
}

export function createMcpServer(convexAuthToken: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(convexAuthToken);

  const server = new McpServer(
    {
      name: "open-brain",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const searchFactsTool = server.tool(
    MCP_TOOL_NAMES.searchFacts,
    "Search precise structured facts such as names, exact dates, relationships, providers, schools, employers, and stable preferences. Matches by meaning as well as by exact words, so a plain question works and does not need the stored predicate. Use this for direct factual questions and use search_thoughts for narrative decisions or project context. Current facts are returned by default. Set includeHistorical for what used to be true. Cite results as fact:<id>.",
    {
      query: z
        .string()
        .trim()
        .min(1)
        .max(12_000)
        .describe("Exact names, predicates, or the user's factual question"),
      limit: z.number().min(1).max(50).default(10),
      includeHistorical: z.boolean().default(false),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.searchFacts],
    async ({ query, limit, includeHistorical }) => {
      const facts: FactResult[] = await convex.action(
        api.models.facts.mcpActions.search,
        { query, limit, includeHistorical },
      );
      return {
        content: [
          {
            type: "text" as const,
            text:
              facts.length === 0
                ? "No matching facts found."
                : JSON.stringify(facts.map(formatFactForMcp), null, 2),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );

  const rememberFactTool = server.tool(
    MCP_TOOL_NAMES.rememberFact,
    "Store one precise, independently changeable fact explicitly stated or confirmed by the user. Use one subject, one snake_case predicate, and one typed value. Use an entity value for relationships. Never store a derived age: store date_of_birth only if an exact date is known. Never use this directly for connector-derived or inferred information; preview those candidates and call only after user confirmation. Single-valued predicates preserve prior values as history; use changeKind corrected when the prior value was inaccurate.",
    {
      subject: entitySelectorSchema.describe("The entity this fact is about"),
      predicate: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,63}$/)
        .describe(
          "Stable snake_case relation or attribute such as date_of_birth or primary_care_provider",
        ),
      value: factValueSchema,
      sourceType: z
        .enum(["user_stated", "user_confirmed"])
        .describe(
          "user_stated for the current conversation; user_confirmed only after approval of an import candidate",
        ),
      sourceRef: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .optional()
        .describe("Optional non-secret source label or reference"),
      observedAt: validityTimestampSchema
        .optional()
        .describe(
          "When the source was observed; not when the fact became true",
        ),
      batchId: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional import batch identifier for traceability"),
      isCore: z
        .boolean()
        .optional()
        .describe("True only for a small set of broadly useful enduring facts"),
      validFrom: validityTimestampSchema
        .optional()
        .describe("When this fact became true, only when explicitly known"),
      validTo: validityTimestampSchema
        .optional()
        .describe(
          "When this fact stopped being true, only when explicitly known",
        ),
      cardinality: z
        .enum(["single", "multiple"])
        .default("single")
        .describe(
          "single replaces the current value for this predicate; multiple permits concurrent values",
        ),
      changeKind: z
        .enum(["changed", "corrected"])
        .default("changed")
        .describe(
          "changed means the old value was formerly true; corrected means it was inaccurate",
        ),
      changeReason: z.string().trim().min(1).max(500).optional(),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.rememberFact],
    async ({
      subject,
      predicate,
      value,
      sourceType,
      sourceRef,
      observedAt,
      batchId,
      isCore,
      validFrom,
      validTo,
      cardinality,
      changeKind,
      changeReason,
    }) => {
      const validity = parseValidityWindow(validFrom, validTo);
      const convertedValue =
        value.type === "datetime"
          ? {
              type: "datetime" as const,
              value: parseValidityTimestamp(value.value),
            }
          : value;
      const result: {
        factId: string;
        statement: string;
        operation: "stored" | "noop" | "superseded" | "corrected";
      } = await convex.action(api.models.facts.mcpActions.remember, {
        subject,
        predicate,
        value: convertedValue,
        sourceType,
        sourceRef,
        observedAt:
          observedAt === undefined
            ? undefined
            : parseValidityTimestamp(observedAt),
        batchId,
        isCore,
        ...validity,
        cardinality,
        changeKind,
        changeReason,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { ...result, citation: `fact:${result.factId}` },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  const searchThoughtsTool = server.tool(
    MCP_TOOL_NAMES.searchThoughts,
    "Use this when you need to search durable memory by meaning and keyword. Pass the user's exact wording when possible, especially names, identifiers, and version strings. Current memories are searched by default. Set includeHistorical for questions about prior states, corrections, or how something changed. Returns a compact index; use `get_thoughts` to fetch full content. Cite sources as `thought:<id>`.",
    {
      query: z.string().describe("Natural language or keyword query"),
      type: z
        .enum(THOUGHT_TYPE_VALUES)
        .optional()
        .describe(THOUGHT_TYPE_FILTER_DESCRIPTION),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results to return"),
      includeHistorical: z
        .boolean()
        .default(false)
        .describe(
          "Include superseded and retracted memories for historical questions",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.searchThoughts],
    async ({ query, type, limit, includeHistorical }) => {
      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        score: number;
        createdAt: number;
        memoryStatus: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
        supersededAt?: number;
        changeReason?: string;
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.search,
        {
          query,
          type,
          limit,
          includeHistorical,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching thoughts found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                score: r.score,
                memoryStatus: r.memoryStatus,
                isCore: r.isCore ?? false,
                validFrom:
                  r.validFrom !== undefined
                    ? new Date(r.validFrom).toISOString()
                    : undefined,
                validTo:
                  r.validTo !== undefined
                    ? new Date(r.validTo).toISOString()
                    : undefined,
                supersededAt: r.supersededAt
                  ? new Date(r.supersededAt).toISOString()
                  : undefined,
                changeReason: r.changeReason,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );

  const recallContextTool = server.tool(
    MCP_TOOL_NAMES.recallContext,
    "Use this at the start of a relevant turn to recall precise facts and narrative context before answering. Pass the user's complete current message verbatim; do not paraphrase or normalize exact names, identifiers, project names, or version strings. Returns a bounded blend: at most one core fact at the default limit, then the most relevant current facts and memories; a core memory appears only when it is relevant. Also reports what the brain does not know: a gaps block follows the memories when the window is stale, holds conflicting facts, or lacks an attribute the question asked for; surface those gaps when answering. Set includeHistorical only for an explicitly historical question. Cite sources as fact:<id> or thought:<id>.",
    {
      query: z
        .string()
        .min(1)
        .max(12_000)
        .describe("The user's complete current message, copied verbatim"),
      limit: z
        .number()
        .min(1)
        .max(8)
        .default(5)
        .describe("Maximum memories to recall"),
      includeHistorical: z
        .boolean()
        .default(false)
        .describe(
          "Include superseded and retracted memories only for explicitly historical questions",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.recallContext],
    async ({ query, limit, includeHistorical }) => {
      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        score: number;
        createdAt: number;
        memoryStatus: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
        supersededAt?: number;
        changeReason?: string;
      };
      type ContextFact = FactResult;
      // Core slots go to facts only; a core memory reaches the window through
      // the relevance ranking or not at all. At limit one or two there is no
      // core slot, and listCore rejects a zero limit, so the query is skipped.
      const coreLimit = coreLimitFor(limit);
      const [coreFacts, relevantFacts, index]: [
        ContextFact[],
        ContextFact[],
        IndexRow[],
      ] = await Promise.all([
        coreLimit === 0
          ? Promise.resolve([])
          : convex.query(api.models.facts.mcpQueries.listCore, {
              limit: coreLimit,
            }),
        convex.action(api.models.facts.mcpActions.search, {
          query,
          limit,
          includeHistorical,
        }),
        convex.action(api.models.thoughts.mcpActions.search, {
          query,
          limit,
          includeHistorical,
        }),
      ]);

      if (
        coreFacts.length === 0 &&
        relevantFacts.length === 0 &&
        index.length === 0
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Run /brain-init to add initial context, then try recall_context again.",
            },
          ],
        };
      }

      const {
        coreFacts: selectedCoreFacts,
        relevanceFacts,
        relevanceThoughts: relevanceIndex,
      } = blendRecallContext({
        coreFacts,
        relevantFacts,
        relevantThoughts: index,
        limit,
        factId: (fact) => fact.id,
      });

      type Thought = {
        _id: string;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        createdAt: number;
        updatedAt?: number;
        memoryStatus: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
        supersededAt?: number;
        supersededBy?: string;
        supersedes?: string[];
        changeReason?: string;
      };
      const thoughts: Thought[] =
        relevanceIndex.length === 0
          ? []
          : await convex.action(api.models.thoughts.mcpActions.getByIds, {
              ids: relevanceIndex.map((row) => row._id) as never,
            });
      const thoughtById = new Map(
        thoughts.map((thought) => [thought._id, thought]),
      );
      const coreFactContext = selectedCoreFacts.map((fact) => ({
        ...formatFactForMcp(fact),
        memoryKind: "fact" as const,
        source: "core" as const,
      }));
      const relevanceFactContext = relevanceFacts.map((fact) => ({
        ...formatFactForMcp(fact),
        memoryKind: "fact" as const,
        source: "relevance" as const,
      }));
      const relevanceContext = relevanceIndex.flatMap((row) => {
        const thought = thoughtById.get(row._id);
        if (!thought) return [];
        return [
          {
            id: thought._id,
            citation: `thought:${thought._id}`,
            content: truncateContext(thought.content),
            metadata: thought.metadata,
            memoryKind: "thought" as const,
            source: "relevance" as const,
            score: row.score,
            memoryStatus: thought.memoryStatus,
            isCore: thought.isCore ?? false,
            validFrom:
              thought.validFrom !== undefined
                ? new Date(thought.validFrom).toISOString()
                : undefined,
            validTo:
              thought.validTo !== undefined
                ? new Date(thought.validTo).toISOString()
                : undefined,
            supersededAt:
              thought.supersededAt !== undefined
                ? new Date(thought.supersededAt).toISOString()
                : undefined,
            supersededBy: thought.supersededBy,
            supersedes: thought.supersedes,
            changeReason: thought.changeReason,
            createdAt: new Date(thought.createdAt).toISOString(),
          },
        ];
      });
      const context = [
        ...coreFactContext,
        ...relevanceFactContext,
        ...relevanceContext,
      ];

      // What the window does not say, computed from the window itself. The
      // memories block stays a bare, machine-parseable array; gaps follow it
      // as sibling blocks, only when there is something to report, and only
      // in the room the memories block leaves under the declared result size.
      const gaps = computeRecallGaps({
        query,
        now: Date.now(),
        coreFacts: selectedCoreFacts,
        relevanceFacts,
        thoughts: thoughts.map((thought) => ({
          id: thought._id,
          content: thought.content,
          memoryStatus: thought.memoryStatus,
          validFrom: thought.validFrom,
          validTo: thought.validTo,
          createdAt: thought.createdAt,
          updatedAt: thought.updatedAt,
        })),
      });

      const memoriesText = JSON.stringify(context, null, 2);
      const gapBlocks = fitRecallGapBlocks(
        gaps,
        RECALL_RESULT_SIZE_CHARS - memoriesText.length,
      );

      return {
        content: [
          { type: "text" as const, text: memoriesText },
          ...gapBlocks.map((text) => ({ type: "text" as const, text })),
        ],
        _meta: { "anthropic/maxResultSizeChars": RECALL_RESULT_SIZE_CHARS },
      };
    },
  );

  const listCoreMemoriesTool = server.tool(
    MCP_TOOL_NAMES.listCoreMemories,
    "List the account's current core facts and core memories without a query. Core context is the small, explicitly marked set of enduring identity facts, constraints, preferences, and active-project state. Cheap and read-only: no search runs. Use it to load standing context at the start of a session; use recall_context for context specific to a message. Newest core context comes first; if the result would exceed its size budget, trailing entries are dropped and truncated is true. Cite sources as fact:<id> or thought:<id>.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_CORE_MEMORY_LIMIT)
        .default(DEFAULT_CORE_MEMORY_LIMIT)
        .describe(
          "Maximum core facts and, separately, core memories to return",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.listCoreMemories],
    async ({ limit }) => {
      const [coreFacts, coreThoughts]: [FactResult[], CoreThought[]] =
        await Promise.all([
          convex.query(api.models.facts.mcpQueries.listCore, { limit }),
          convex.query(api.models.thoughts.mcpQueries.listCore, { limit }),
        ]);

      return {
        content: [
          {
            type: "text" as const,
            text: serializeCoreMemoriesWithinBudget(
              coreFacts.map((fact) => ({
                ...formatFactForMcp(fact),
                memoryKind: "fact" as const,
                source: "core" as const,
              })),
              coreThoughts.map(formatCoreThoughtForMcp),
              LIST_CORE_MEMORIES_RESULT_BUDGET_CHARS,
            ),
          },
        ],
        _meta: {
          "anthropic/maxResultSizeChars":
            LIST_CORE_MEMORIES_RESULT_BUDGET_CHARS,
        },
      };
    },
  );

  const browseRecentTool = server.tool(
    MCP_TOOL_NAMES.browseRecent,
    "Browse most recent current thoughts, optionally filtered by type or topic. Set includeHistorical to include superseded and corrected memories. Cite sources as `thought:<id>`.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("How many thoughts to return"),
      type: z
        .enum(THOUGHT_TYPE_VALUES)
        .optional()
        .describe(THOUGHT_TYPE_FILTER_DESCRIPTION),
      topic: z.string().optional().describe("Filter by topic keyword"),
      includeHistorical: z
        .boolean()
        .default(false)
        .describe("Include superseded and retracted memories"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.browseRecent],
    async ({ limit, type, topic, includeHistorical }) => {
      type Thought = {
        _id: string;
        _creationTime: number;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        userId: string;
        memoryStatus?: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
        supersededAt?: number;
        changeReason?: string;
      };
      const results: Thought[] = await convex.query(
        api.models.thoughts.mcpQueries.listByUser,
        { limit, includeHistorical },
      );

      let filtered = results;
      if (type) {
        filtered = filtered.filter((t) => t.metadata.type === type);
      }
      if (topic) {
        const lowerTopic = topic.toLowerCase();
        filtered = filtered.filter((t) =>
          t.metadata.topics.some((tp) => tp.toLowerCase().includes(lowerTopic)),
        );
      }

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found matching the criteria.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              filtered.map((t) => ({
                id: t._id,
                content: t.content,
                metadata: t.metadata,
                memoryStatus: t.memoryStatus ?? "current",
                isCore: t.isCore ?? false,
                validFrom:
                  t.validFrom !== undefined
                    ? new Date(t.validFrom).toISOString()
                    : undefined,
                validTo:
                  t.validTo !== undefined
                    ? new Date(t.validTo).toISOString()
                    : undefined,
                supersededAt: t.supersededAt
                  ? new Date(t.supersededAt).toISOString()
                  : undefined,
                changeReason: t.changeReason,
                createdAt: new Date(t._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  const getThoughtsTool = server.tool(
    MCP_TOOL_NAMES.getThoughts,
    "Fetch full content and lifecycle links for specific thought IDs. Use after `search_thoughts` and batch multiple IDs in one call. Treat current memories as authoritative; superseded memories were formerly current, while retracted memories were inaccurate.",
    {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Thought IDs (from a prior search_thoughts call)"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getThoughts],
    async ({ ids }) => {
      type Thought = {
        _id: string;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        createdAt: number;
        updatedAt?: number;
        memoryStatus: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
        supersededAt?: number;
        supersededBy?: string;
        supersedes?: string[];
        changeReason?: string;
      };
      const results: Thought[] = await convex.action(
        api.models.thoughts.mcpActions.getByIds,
        { ids: ids as never },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found for the provided IDs.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                content: r.content,
                metadata: r.metadata,
                createdAt: new Date(r.createdAt).toISOString(),
                updatedAt: r.updatedAt
                  ? new Date(r.updatedAt).toISOString()
                  : undefined,
                memoryStatus: r.memoryStatus,
                isCore: r.isCore ?? false,
                validFrom:
                  r.validFrom !== undefined
                    ? new Date(r.validFrom).toISOString()
                    : undefined,
                validTo:
                  r.validTo !== undefined
                    ? new Date(r.validTo).toISOString()
                    : undefined,
                supersededAt: r.supersededAt
                  ? new Date(r.supersededAt).toISOString()
                  : undefined,
                supersededBy: r.supersededBy,
                supersedes: r.supersedes,
                changeReason: r.changeReason,
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  const timelineThoughtsTool = server.tool(
    MCP_TOOL_NAMES.timelineThoughts,
    "Fetch thoughts captured around a specific point in time. Provide either `seedId` (anchor on another thought) or `aroundMs` (epoch ms). Returns compact index rows ordered oldest→newest — use `get_thoughts` for full content. Cite sources as `thought:<id>`.",
    {
      seedId: z
        .string()
        .optional()
        .describe("Thought ID to anchor the window around"),
      aroundMs: z
        .number()
        .optional()
        .describe("Epoch milliseconds to anchor the window around"),
      before: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from before the anchor"),
      after: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from after the anchor"),
      type: z
        .enum(THOUGHT_TYPE_VALUES)
        .optional()
        .describe(THOUGHT_TYPE_FILTER_DESCRIPTION),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.timelineThoughts],
    async ({ seedId, aroundMs, before, after, type }) => {
      if (!seedId && aroundMs === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: provide either `seedId` or `aroundMs`.",
            },
          ],
          isError: true,
        };
      }
      if (seedId && aroundMs !== undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: provide only one of `seedId` or `aroundMs`, not both.",
            },
          ],
          isError: true,
        };
      }

      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        createdAt: number;
        memoryStatus: "current" | "superseded" | "retracted";
        isCore?: boolean;
        validFrom?: number;
        validTo?: number;
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.timeline,
        {
          seedId: seedId as never,
          aroundMs,
          before,
          after,
          type,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found in the requested window.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                memoryStatus: r.memoryStatus,
                isCore: r.isCore ?? false,
                validFrom:
                  r.validFrom !== undefined
                    ? new Date(r.validFrom).toISOString()
                    : undefined,
                validTo:
                  r.validTo !== undefined
                    ? new Date(r.validTo).toISOString()
                    : undefined,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );

  const getStatsTool = server.tool(
    MCP_TOOL_NAMES.getStats,
    "Get overview statistics of what's stored in your brain",
    {},
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getStats],
    async () => {
      const stats = await convex.query(
        api.models.thoughts.mcpQueries.getStats,
        {},
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  const captureThoughtTool = server.tool(
    MCP_TOOL_NAMES.captureThought,
    "Store one atomic durable narrative memory: a decision with rationale, coherent project state, commitment, or recurring pattern whose parts change together. Use remember_fact instead for precise attributes and relationships. Never send biographies, dossiers, mixed people/projects, completed-task catalogs, activity logs, connector observations, assistant guesses, or inferred user facts. The admission gate may decline storage or request confirmation. The server deduplicates and preserves changed or corrected prior information as linked history.",
    {
      content: z
        .string()
        .trim()
        .min(1)
        .max(MAX_CAPTURE_CONTENT_CHARS)
        .describe(
          "One standalone durable narrative memory about one subject and one coherent change cadence. Preserve exact proper nouns, identifiers, and version strings.",
        ),
      sourceType: z
        .enum(["user_stated", "user_confirmed", "assistant_commitment"])
        .describe(
          "Grounding for this memory. Never label connector-derived or inferred content as user_stated.",
        ),
      sourceRef: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .optional()
        .describe("Optional non-secret source label or reference"),
      observedAt: validityTimestampSchema
        .optional()
        .describe("When the source was observed; not when the memory was true"),
      batchId: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional confirmed import batch identifier"),
      validFrom: validityTimestampSchema
        .optional()
        .describe(
          "When the fact became true in the real world, only if the user explicitly stated or confirmed it. ISO-8601 date or timezone-qualified datetime. Never use capture or supersession time.",
        ),
      validTo: validityTimestampSchema
        .optional()
        .describe(
          "When the fact stopped being true in the real world, only if the user explicitly stated or confirmed it. ISO-8601 date or timezone-qualified datetime. Never use capture or supersession time.",
        ),
      isCore: z
        .boolean()
        .optional()
        .describe(
          "True only for the small set of enduring identity facts, constraints, and preferences useful across many conversations. False explicitly demotes an existing core memory. Omit for ordinary durable memories.",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.captureThought],
    async ({
      content,
      sourceType,
      sourceRef,
      observedAt,
      batchId,
      validFrom,
      validTo,
      isCore,
    }) => {
      type CaptureResult = {
        thoughtId?: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        disposition:
          | "stored"
          | "duplicate"
          | "superseded"
          | "corrected"
          | "needs_confirmation"
          | "skipped";
        operationSummary?: string;
      };
      const validity = parseValidityWindow(validFrom, validTo);
      const result: CaptureResult = await convex.action(
        api.models.thoughts.mcpActions.capture,
        {
          content,
          ...validity,
          isCore,
          sourceType,
          sourceRef,
          observedAt:
            observedAt === undefined
              ? undefined
              : parseValidityTimestamp(observedAt),
          batchId,
        },
      );

      const stored = [
        "stored",
        "duplicate",
        "superseded",
        "corrected",
      ].includes(result.disposition);
      const statusLine = result.operationSummary
        ? result.operationSummary
        : stored
          ? "Thought captured successfully"
          : "Thought was not stored";

      // A refusal must be unmistakable. A success-shaped needs_confirmation
      // let callers report "saved" while the write was dropped, and nothing
      // downstream could tell the difference.
      return {
        isError: !stored,
        content: [
          {
            type: "text" as const,
            text: [
              `${statusLine}.`,
              `Disposition: ${result.disposition}`,
              result.thoughtId ? `Citation: thought:${result.thoughtId}` : "",
              "",
              `Type: ${result.metadata.type}`,
              `Topics: ${result.metadata.topics.join(", ") || "none"}`,
              `People: ${result.metadata.people.join(", ") || "none"}`,
              `Summary: ${result.metadata.summary}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    },
  );

  const createReportTool = server.tool(
    MCP_TOOL_NAMES.createReport,
    "Create a workflow analysis report with structured insights",
    {
      startDate: z.string().describe("Report period start date (ISO format)"),
      endDate: z.string().describe("Report period end date (ISO format)"),
      sessionsAnalyzed: z.number().describe("Number of sessions analyzed"),
      totalPrompts: z.number().describe("Total prompts in period"),
      totalToolCalls: z.number().describe("Total tool calls in period"),
      projectsActive: z
        .array(z.object({ path: z.string(), sessions: z.number() }))
        .describe("Active projects with session counts"),
      modelUsage: z
        .record(z.string(), z.number())
        .describe("Model usage counts keyed by model name"),
      insights: z
        .array(
          z.object({
            category: z.enum([
              "feature-discovery",
              "anti-pattern",
              "productivity",
              "automation",
              "ecosystem",
            ]),
            observation: z.string(),
            recommendation: z.string(),
            evidence: z.string(),
            links: z
              .array(
                z.object({
                  label: z.string().describe("Display text for the link"),
                  url: z.string().describe("URL to link to"),
                }),
              )
              .optional()
              .describe("Related links (docs, plugins, tools)"),
          }),
        )
        .describe("Structured insights from the analysis"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.createReport],
    async (args) => {
      type CreateReportResult = {
        reportId: string;
        insightIds: string[];
      };
      const result: CreateReportResult = await convex.action(
        api.models.reports.mcpActions.createReport,
        args,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Report created successfully.",
              "",
              `Report ID: ${result.reportId}`,
              `Insights created: ${result.insightIds.length}`,
              `Period: ${args.startDate} to ${args.endDate}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  const getInsightsTool = server.tool(
    MCP_TOOL_NAMES.getInsights,
    "Get workflow insights, optionally filtered by status or category. Cite insights as `insight:<id>` when referencing them in your response.",
    {
      status: z
        .enum(["new", "noted", "done", "dismissed"])
        .optional()
        .describe("Filter by insight status"),
      category: z
        .enum([
          "feature-discovery",
          "anti-pattern",
          "productivity",
          "automation",
          "ecosystem",
        ])
        .optional()
        .describe("Filter by insight category"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Max results to return"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getInsights],
    async ({ status, category, limit }) => {
      type Insight = {
        _id: string;
        _creationTime: number;
        category: string;
        observation: string;
        recommendation: string;
        evidence: string;
        links?: { label: string; url: string }[];
        status: string;
        dismissTag?: string;
        dismissText?: string;
      };
      const results: Insight[] = await convex.query(
        api.models.reports.mcpQueries.listInsights,
        { status, category, limit },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No insights found matching the criteria.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((i) => ({
                id: i._id,
                category: i.category,
                observation: i.observation,
                recommendation: i.recommendation,
                evidence: i.evidence,
                links: i.links,
                status: i.status,
                dismissTag: i.dismissTag,
                dismissText: i.dismissText,
                createdAt: new Date(i._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  const retractThoughtTool = server.tool(
    MCP_TOOL_NAMES.retractThought,
    "Withdraw one narrative memory the user says is wrong: it was never true, as opposed to outdated. Use only when the user asserts the memory is wrong or was captured in error, never to tidy up memories that merely became outdated — outdated memories are replaced by capturing the current state, which preserves them as history. A retracted memory is kept but withheld from every read path, and is reversible with restore_thought while no replacement memory exists. To erase a memory outright rather than mark it, use forget_thought instead.",
    {
      thoughtId: z.string().describe("The ID of the memory to retract"),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe(
          "Why this memory is wrong, in the user's terms. Recorded on the memory.",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.retractThought],
    async ({ thoughtId, reason }) => {
      await convex.mutation(api.models.thoughts.mcpMutations.retractThought, {
        thoughtId: thoughtId as never,
        reason,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory retracted and withheld from recall. Cite it as thought:${thoughtId}. Undo with restore_thought if this was a mistake.`,
          },
        ],
      };
    },
  );

  const restoreThoughtTool = server.tool(
    MCP_TOOL_NAMES.restoreThought,
    "Undo a retraction and return the memory to current. Works only on a memory retracted by retract_thought; a memory retired by a replacement cannot be revived this way, because its replacement is current and the two would contradict.",
    {
      thoughtId: z.string().describe("The ID of the retracted memory"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.restoreThought],
    async ({ thoughtId }) => {
      await convex.mutation(api.models.thoughts.mcpMutations.restoreThought, {
        thoughtId: thoughtId as never,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory restored to current and retrievable again. Cite it as thought:${thoughtId}.`,
          },
        ],
      };
    },
  );

  const forgetReasonSchema = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      "Why this must not remain in storage, in the user's terms. Returned in the response but not recorded anywhere: nothing remains to record it on.",
    );

  const forgetThoughtTool = server.tool(
    MCP_TOOL_NAMES.forgetThought,
    "Permanently delete one narrative memory that must not remain in storage, such as a mis-captured credential or a third party's private detail. Retract when it was wrong; forget when it must not remain in storage. This is a hard delete with no undo: the memory is removed rather than marked, and it disappears from history as well as from recall. Use only when the user asks for the memory to be erased, never to correct or tidy. If the memory had replaced an earlier one, the earlier one stays retired rather than being revived; its id is returned so it can be restated deliberately.",
    {
      thoughtId: z.string().describe("The ID of the memory to delete"),
      reason: forgetReasonSchema,
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.forgetThought],
    async ({ thoughtId, reason }) => {
      const result = await convex.mutation(
        api.models.thoughts.mcpMutations.forgetThought,
        { thoughtId: thoughtId as never, reason },
      );
      const notes: string[] = [];
      if (result.detachedPredecessors.length > 0) {
        notes.push(
          `Earlier memories it had replaced stay retired and are no longer linked to it: ${result.detachedPredecessors.map((id) => `thought:${id}`).join(", ")}.`,
        );
      }
      if (result.detachedSuccessor) {
        notes.push(
          `Its replacement thought:${result.detachedSuccessor} remains current and no longer lists it.`,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Memory thought:${thoughtId} permanently deleted (reason: ${result.reason}). Nothing remains to cite or restore.`,
              ...notes,
            ].join(" "),
          },
        ],
      };
    },
  );

  const forgetFactTool = server.tool(
    MCP_TOOL_NAMES.forgetFact,
    "Permanently delete one structured fact that must not remain in storage. Retract when it was wrong (use remember_fact with changeKind corrected); forget when it must not remain in storage. This is a hard delete with no undo: the fact is removed from current results and from history. The subject entity is kept; use forget_entity when the entity itself must not remain. Use only when the user asks for the fact to be erased.",
    {
      factId: z.string().describe("The ID of the fact to delete"),
      reason: forgetReasonSchema,
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.forgetFact],
    async ({ factId, reason }) => {
      const result = await convex.mutation(api.models.facts.mcpActions.forget, {
        factId: factId as never,
        reason,
      });
      const notes: string[] = [];
      if (result.detachedPredecessors.length > 0) {
        notes.push(
          `Earlier values it had replaced stay retired and are no longer linked to it: ${result.detachedPredecessors.map((id) => `fact:${id}`).join(", ")}.`,
        );
      }
      if (result.detachedSuccessor) {
        notes.push(
          `Its replacement fact:${result.detachedSuccessor} remains current and no longer lists it.`,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Fact fact:${factId} permanently deleted (reason: ${result.reason}). Nothing remains to cite.`,
              ...notes,
            ].join(" "),
          },
        ],
      };
    },
  );

  const forgetEntityTool = server.tool(
    MCP_TOOL_NAMES.forgetEntity,
    "Permanently delete an entity (a person, organization, project, or place) that must not remain in storage, together with every fact about it and every fact on another subject that points at it. Retract when a fact was wrong; forget when the entity must not remain in memory at all, such as a third party whose details were captured by mistake. This is a hard delete with no undo, and it cascades: facts whose value is this entity are deleted too, because their text carries the entity's name. Entity ids appear as subject.id and value.entity.id in search_facts results. Use only when the user asks for the entity to be erased.",
    {
      entityId: z.string().describe("The ID of the entity to delete"),
      reason: forgetReasonSchema,
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.forgetEntity],
    async ({ entityId, reason }) => {
      // The mutation deletes a bounded batch per call and removes the entity
      // row only when nothing is left, so looping here is safe to interrupt:
      // a partial run leaves an entity a repeat call can finish. The cap is a
      // guard against a pathological account, not an expected exit.
      const MAX_BATCHES = 200;
      const deletedSubjectFactIds: string[] = [];
      const deletedReferencingFacts: Array<{
        factId: string;
        subjectEntityId: string;
        predicate: string;
      }> = [];
      const detachedSuccessors = new Set<string>();
      let key = "";
      let normalizedReason = reason;
      let done = false;
      let batches = 0;
      while (!done && batches < MAX_BATCHES) {
        const result = await convex.mutation(
          api.models.facts.mcpActions.forgetEntityWithFacts,
          { entityId: entityId as never, reason },
        );
        batches += 1;
        key = result.key;
        normalizedReason = result.reason;
        done = result.done;
        deletedSubjectFactIds.push(...result.deletedSubjectFactIds);
        deletedReferencingFacts.push(...result.deletedReferencingFacts);
        for (const id of result.detachedSuccessors) detachedSuccessors.add(id);
      }
      // A successor detached in one batch may itself point at the entity and
      // be deleted in a later one; report only replacements that survived.
      const deletedIds = new Set([
        ...deletedSubjectFactIds,
        ...deletedReferencingFacts.map((fact) => fact.factId),
      ]);
      const survivingReplacements = [...detachedSuccessors].filter(
        (id) => !deletedIds.has(id),
      );

      // Counts and id lists live in the structured block so every claim in
      // the narrative is one the reader can cite.
      const summary = {
        entity: { id: entityId, key },
        reason: normalizedReason,
        done,
        batches,
        deletedFactsAboutEntity: deletedSubjectFactIds.map(
          (id) => `fact:${id}`,
        ),
        deletedFactsPointingAtEntity: deletedReferencingFacts.map((fact) => ({
          citation: `fact:${fact.factId}`,
          predicate: fact.predicate,
          subjectEntityId: fact.subjectEntityId,
        })),
        survivingReplacements: survivingReplacements.map((id) => `fact:${id}`),
      };
      const narrative = done
        ? `Entity ${key} (${entityId}) permanently deleted (reason: ${normalizedReason}). The facts removed with it are listed by citation below. Restate any relationship that pointed at it with remember_fact if the user wants it kept against a different value.`
        : `Entity ${key} (${entityId}) is not yet deleted: ${MAX_BATCHES} batches ran and facts still remain. Call forget_entity again with the same id to continue; the facts removed so far are listed below.`;
      return {
        content: [
          { type: "text" as const, text: narrative },
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
        ...(done ? {} : { isError: true }),
      };
    },
  );

  const deleteInsightTool = server.tool(
    MCP_TOOL_NAMES.deleteInsight,
    "Delete a specific insight by ID",
    {
      insightId: z.string().describe("The ID of the insight to delete"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.deleteInsight],
    async ({ insightId }) => {
      await convex.mutation(api.models.reports.mcpMutations.deleteInsight, {
        insightId: insightId as never,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "Insight deleted successfully.",
          },
        ],
      };
    },
  );

  // --- Lists ---

  const createListTool = server.tool(
    MCP_TOOL_NAMES.createList,
    "Create a new named list for tracking items (todos, goals, etc.)",
    {
      name: z
        .string()
        .describe("Name for the list (e.g., 'This Week', 'Q2 Goals')"),
      pinned: z
        .boolean()
        .default(false)
        .describe(
          "If true, this list is loaded proactively by AI tools at session start",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.createList],
    async ({ name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createList,
        { name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List created: "${result.name}"${result.pinned ? " (pinned)" : ""}\nList ID: ${result.listId}`,
          },
        ],
      };
    },
  );

  const updateListTool = server.tool(
    MCP_TOOL_NAMES.updateList,
    "Update a list's name or pinned status",
    {
      listId: z.string().describe("The list ID to update"),
      name: z.string().optional().describe("New name for the list"),
      pinned: z.boolean().optional().describe("Set pinned status"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.updateList],
    async ({ listId, name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateList,
        { listId: listId as never, name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List updated: "${result.name}"${result.pinned ? " (pinned)" : ""}`,
          },
        ],
      };
    },
  );

  const getListsTool = server.tool(
    MCP_TOOL_NAMES.getLists,
    "Get all lists with item counts, optionally filtered to pinned only",
    {
      pinned: z.boolean().optional().describe("Filter to pinned lists only"),
      includeArchived: z
        .boolean()
        .default(false)
        .describe("Include archived lists"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getLists],
    async ({ pinned, includeArchived }) => {
      type ListResult = {
        listId: string;
        name: string;
        pinned: boolean;
        archivedAt?: number;
        counts: { total: number; open: number; done: number };
      };
      const results: ListResult[] = await convex.query(
        api.models.lists.mcpQueries.getLists,
        { pinned, includeArchived },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No lists found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 100000 },
      };
    },
  );

  const getListTool = server.tool(
    MCP_TOOL_NAMES.getList,
    "Get a single list with its ordered items",
    {
      listId: z.string().describe("The list ID to fetch"),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include completed items (excluded by default)"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getList],
    async ({ listId, includeCompleted }) => {
      type ListDetail = {
        listId: string;
        name: string;
        pinned: boolean;
        items: Array<{
          itemId: string;
          title: string;
          status: string;
          position: number;
          completedAt?: number;
          url?: string;
          description?: string;
          properties?: Record<string, unknown>;
        }>;
      };
      const result: ListDetail = await convex.query(
        api.models.lists.mcpQueries.getList,
        { listId: listId as never, includeCompleted },
      );

      const itemLines =
        result.items.length > 0
          ? result.items.map((i) => {
              let line = `${i.status === "done" ? "[x]" : "[ ]"} ${i.title} (id: ${i.itemId})`;
              if (i.url) line += `\n    URL: ${i.url}`;
              if (i.description) line += `\n    ${i.description}`;
              if (i.properties)
                line += `\n    Properties: ${JSON.stringify(i.properties)}`;
              return line;
            })
          : ["(no items)"];

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${result.name}${result.pinned ? " (pinned)" : ""}`,
              `List ID: ${result.listId}`,
              "",
              ...itemLines,
            ].join("\n"),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  const archiveListTool = server.tool(
    MCP_TOOL_NAMES.archiveList,
    "Archive a list (soft delete — items remain intact for review)",
    {
      listId: z.string().describe("The list ID to archive"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.archiveList],
    async ({ listId }) => {
      await convex.mutation(api.models.lists.mcpActions.archiveList, {
        listId: listId as never,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "List archived.",
          },
        ],
      };
    },
  );

  const createListItemTool = server.tool(
    MCP_TOOL_NAMES.createListItem,
    "Add an item to a list",
    {
      listId: z.string().describe("The list to add the item to"),
      title: z.string().describe("The item text"),
      url: z.string().optional().describe("Optional URL for the item"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the item"),
      properties: z
        .record(z.string(), z.any())
        .optional()
        .describe("Optional custom properties object"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.createListItem],
    async ({ listId, title, url, description, properties }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createListItem,
        { listId: listId as never, title, url, description, properties },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Added: "${result.title}" (id: ${result.itemId})`,
          },
        ],
      };
    },
  );

  const updateListItemTool = server.tool(
    MCP_TOOL_NAMES.updateListItem,
    "Update a list item — change title, mark done/open, or reorder",
    {
      itemId: z.string().describe("The item ID to update"),
      title: z.string().optional().describe("New title text"),
      status: z
        .enum(["open", "done"])
        .optional()
        .describe("Set status (done = check off, open = reopen)"),
      position: z.number().optional().describe("New position for reordering"),
      url: z.string().optional().describe("New URL for the item"),
      description: z
        .string()
        .optional()
        .describe("New description for the item"),
      properties: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Custom properties object (replaces entire properties field — caller should merge with existing before sending)",
        ),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.updateListItem],
    async ({
      itemId,
      title,
      status,
      position,
      url,
      description,
      properties,
    }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateListItem,
        {
          itemId: itemId as never,
          title,
          status,
          position,
          url,
          description,
          properties,
        },
      );

      const statusText = result.status === "done" ? " [done]" : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated: "${result.title}"${statusText}`,
          },
        ],
      };
    },
  );

  const getOpenItemsTool = server.tool(
    MCP_TOOL_NAMES.getOpenItems,
    "Get all open items across all active (non-archived) lists",
    {
      limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Max items to return"),
    },
    MCP_TOOL_ANNOTATIONS[MCP_TOOL_NAMES.getOpenItems],
    async ({ limit }) => {
      type OpenItem = {
        itemId: string;
        title: string;
        position: number;
        listId: string;
        listName: string;
        url?: string;
        description?: string;
        properties?: Record<string, unknown>;
      };
      const results: OpenItem[] = await convex.query(
        api.models.lists.mcpQueries.getOpenItems,
        { limit },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No open items.",
            },
          ],
        };
      }

      // Group by list name for readable output
      const byList = new Map<string, OpenItem[]>();
      for (const item of results) {
        const group = byList.get(item.listName) ?? [];
        group.push(item);
        byList.set(item.listName, group);
      }

      const lines: string[] = [];
      for (const [listName, items] of byList) {
        lines.push(`## ${listName}`);
        for (const item of items) {
          let line = `- [ ] ${item.title} (id: ${item.itemId})`;
          if (item.url) line += `\n    URL: ${item.url}`;
          if (item.description) line += `\n    ${item.description}`;
          if (item.properties)
            line += `\n    Properties: ${JSON.stringify(item.properties)}`;
          lines.push(line);
        }
        lines.push("");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  const registeredTools = {
    [MCP_TOOL_NAMES.searchFacts]: searchFactsTool,
    [MCP_TOOL_NAMES.rememberFact]: rememberFactTool,
    [MCP_TOOL_NAMES.searchThoughts]: searchThoughtsTool,
    [MCP_TOOL_NAMES.recallContext]: recallContextTool,
    [MCP_TOOL_NAMES.listCoreMemories]: listCoreMemoriesTool,
    [MCP_TOOL_NAMES.browseRecent]: browseRecentTool,
    [MCP_TOOL_NAMES.getThoughts]: getThoughtsTool,
    [MCP_TOOL_NAMES.timelineThoughts]: timelineThoughtsTool,
    [MCP_TOOL_NAMES.getStats]: getStatsTool,
    [MCP_TOOL_NAMES.captureThought]: captureThoughtTool,
    [MCP_TOOL_NAMES.retractThought]: retractThoughtTool,
    [MCP_TOOL_NAMES.restoreThought]: restoreThoughtTool,
    [MCP_TOOL_NAMES.forgetThought]: forgetThoughtTool,
    [MCP_TOOL_NAMES.forgetFact]: forgetFactTool,
    [MCP_TOOL_NAMES.forgetEntity]: forgetEntityTool,
    [MCP_TOOL_NAMES.createReport]: createReportTool,
    [MCP_TOOL_NAMES.getInsights]: getInsightsTool,
    [MCP_TOOL_NAMES.deleteInsight]: deleteInsightTool,
    [MCP_TOOL_NAMES.createList]: createListTool,
    [MCP_TOOL_NAMES.updateList]: updateListTool,
    [MCP_TOOL_NAMES.getLists]: getListsTool,
    [MCP_TOOL_NAMES.getList]: getListTool,
    [MCP_TOOL_NAMES.archiveList]: archiveListTool,
    [MCP_TOOL_NAMES.createListItem]: createListItemTool,
    [MCP_TOOL_NAMES.updateListItem]: updateListItemTool,
    [MCP_TOOL_NAMES.getOpenItems]: getOpenItemsTool,
  } satisfies Record<McpToolName, { disable: () => void }>;
  const enabledToolNames = new Set(resolveEnabledMcpToolNames());
  for (const name of MCP_TOOL_NAME_LIST) {
    if (!enabledToolNames.has(name)) registeredTools[name].disable();
  }

  return server;
}
