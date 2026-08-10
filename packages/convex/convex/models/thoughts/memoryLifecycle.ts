export const MEMORY_ACTIONS = ["ADD", "NOOP", "SUPERSEDE", "RETRACT"] as const;

export type MemoryAction = (typeof MEMORY_ACTIONS)[number];
export type MemoryStatus = "current" | "superseded" | "retracted";

export type MemoryValidity = {
  validFrom?: number;
  validTo?: number;
};

export type MemoryClassification = {
  action: MemoryAction;
  relatedThoughtIds: string[];
  reason: string;
  replacementContent?: string;
};

export function isCurrentMemory(status: MemoryStatus | undefined): boolean {
  return status === undefined || status === "current";
}

/**
 * Validates a business-time interval without conflating it with recording
 * time. Open intervals are allowed; a closed interval must have positive
 * duration.
 */
export function assertValidMemoryValidity({
  validFrom,
  validTo,
}: MemoryValidity): void {
  if (
    (validFrom !== undefined && !Number.isFinite(validFrom)) ||
    (validTo !== undefined && !Number.isFinite(validTo)) ||
    (validFrom !== undefined && validTo !== undefined && validFrom >= validTo)
  ) {
    throw new Error("Invalid memory validity interval");
  }
}

/**
 * Returns the end of an older open interval when an explicitly supplied new
 * start makes that closure safe. This must only be used for supersessions,
 * never retractions (an inaccurate claim was not formerly true).
 */
export function safeSupersededValidTo(
  previous: MemoryValidity,
  newValidFrom: number | undefined,
): number | undefined {
  if (
    newValidFrom === undefined ||
    !Number.isFinite(newValidFrom) ||
    previous.validTo !== undefined ||
    (previous.validFrom !== undefined && previous.validFrom >= newValidFrom)
  ) {
    return undefined;
  }
  return newValidFrom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeClassification(
  value: unknown,
  candidateIds: ReadonlySet<string>,
): MemoryClassification | null {
  if (
    !isRecord(value) ||
    !MEMORY_ACTIONS.includes(value.action as MemoryAction)
  ) {
    return null;
  }

  const action = value.action as MemoryAction;
  const reason =
    typeof value.reason === "string" ? value.reason.trim().slice(0, 500) : "";
  if (!reason) return null;

  const rawIds = Array.isArray(value.relatedThoughtIds)
    ? value.relatedThoughtIds
    : [];
  const relatedThoughtIds = [
    ...new Set(
      rawIds.filter(
        (id): id is string => typeof id === "string" && candidateIds.has(id),
      ),
    ),
  ];

  if (action === "ADD") {
    return { action, relatedThoughtIds: [], reason };
  }

  if (action === "NOOP") {
    if (relatedThoughtIds.length === 0) return null;
    return {
      action,
      relatedThoughtIds: [relatedThoughtIds[0]!],
      reason,
    };
  }

  const replacementContent =
    typeof value.replacementContent === "string"
      ? value.replacementContent.trim()
      : "";
  if (relatedThoughtIds.length === 0 || !replacementContent) return null;

  return {
    action,
    relatedThoughtIds,
    reason,
    replacementContent,
  };
}

export function parseMemoryClassification(
  text: string,
  candidateIds: Iterable<string>,
): MemoryClassification | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return normalizeClassification(
      JSON.parse(jsonMatch[0]) as unknown,
      new Set(candidateIds),
    );
  } catch {
    return null;
  }
}
