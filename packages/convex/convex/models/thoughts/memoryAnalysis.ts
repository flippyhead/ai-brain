import {
  parseMemoryClassification,
  type MemoryClassification,
} from "./memoryLifecycle";

export const MAX_CAPTURE_CONTENT_CHARS = 2_000;

export const THOUGHT_TYPES = [
  "decision",
  "person_note",
  "idea",
  "meeting_note",
  "task",
  "reference",
] as const;

export type ThoughtType = (typeof THOUGHT_TYPES)[number];

export type ThoughtMetadataValue = {
  type: ThoughtType;
  topics: string[];
  people: string[];
  actionItems: string[];
  summary: string;
};

export type ThoughtAnalysis = {
  classification: MemoryClassification;
  metadata: ThoughtMetadataValue;
};

export type NarrativePreflightDecision = {
  action: "ASK" | "SKIP";
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 200))
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

export function normalizeCaptureContent(content: string): string {
  const normalized = content.trim();
  if (!normalized || normalized.length > MAX_CAPTURE_CONTENT_CHARS) {
    throw new Error(
      `Memory content must contain 1-${MAX_CAPTURE_CONTENT_CHARS} characters`,
    );
  }
  return normalized;
}

/**
 * Rejects the clearest bad ingestion shapes before paying for embeddings or a
 * model admission call. The model still makes the nuanced durability decision;
 * this guard keeps known bootstrap failure modes deterministic.
 */
export function preflightNarrativeAdmission(
  content: string,
): NarrativePreflightDecision | null {
  const normalized = content.trim();
  const hasDerivedAge =
    /\bage\s*[:=]?\s*\d{1,3}\b/i.test(normalized) ||
    /\b\d{1,3}\s*(?:years?|yrs?)\s+old\b/i.test(normalized);
  if (hasDerivedAge) {
    const mostlyAgeClaim =
      Array.from(normalized).length <= 200 &&
      normalized.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2;
    return {
      action: mostlyAgeClaim ? "SKIP" : "ASK",
      reason: mostlyAgeClaim
        ? "Derived ages go stale; store an exact date_of_birth fact only when explicitly known"
        : "This bundle contains a derived age and must be atomized; omit the age or replace it with an explicitly known date_of_birth fact",
    };
  }

  const bulletCount = normalized
    .split("\n")
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length;
  const sentenceCount = normalized
    .split(/[.!?](?:\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
  const broadHeading =
    /^(?:about me|my team|active projects|work patterns|personal profile|biography)\s*:/i.test(
      normalized,
    );
  if (
    Array.from(normalized).length > 1_200 ||
    bulletCount > 3 ||
    sentenceCount > 5 ||
    broadHeading
  ) {
    return {
      action: "ASK",
      reason:
        "This looks like a broad bucket or activity catalog; split it into atomic structured facts and coherent narrative memories before storage",
    };
  }
  return null;
}

export function fallbackThoughtMetadata(content: string): ThoughtMetadataValue {
  return {
    type: "reference",
    topics: [],
    people: [],
    actionItems: [],
    summary: content.trim().slice(0, 160),
  };
}

export function normalizeThoughtMetadata(
  value: unknown,
  storedContent: string,
): ThoughtMetadataValue {
  const fallback = fallbackThoughtMetadata(storedContent);
  if (!isRecord(value)) return fallback;

  const type = THOUGHT_TYPES.includes(value.type as ThoughtType)
    ? (value.type as ThoughtType)
    : fallback.type;
  const summary =
    typeof value.summary === "string" && value.summary.trim()
      ? value.summary.trim().slice(0, 240)
      : fallback.summary;

  return {
    type,
    topics: uniqueStrings(value.topics, 3),
    people: uniqueStrings(value.people, 10),
    actionItems: uniqueStrings(value.actionItems, 10),
    summary,
  };
}

export function parseThoughtAnalysis(
  text: string,
  candidateIds: Iterable<string>,
  newContent: string,
): ThoughtAnalysis | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const classification = parseMemoryClassification(
    JSON.stringify(value),
    candidateIds,
  );
  if (!classification) return null;

  const storedContent =
    classification.action === "SUPERSEDE" || classification.action === "RETRACT"
      ? classification.replacementContent!
      : newContent;

  return {
    classification,
    metadata: normalizeThoughtMetadata(value.metadata, storedContent),
  };
}

export function canReuseEmbedding(
  originalContent: string,
  storedContent: string,
): boolean {
  return originalContent === storedContent;
}
