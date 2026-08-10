import { describe, expect, test } from "vitest";

import {
  canReuseEmbedding,
  fallbackThoughtMetadata,
  MAX_CAPTURE_CONTENT_CHARS,
  normalizeCaptureContent,
  normalizeThoughtMetadata,
  parseThoughtAnalysis,
} from "./memoryAnalysis";

const candidateIds = ["old-school"];

describe("memory provider analysis", () => {
  test("parses one combined add decision and metadata response", () => {
    expect(
      parseThoughtAnalysis(
        JSON.stringify({
          action: "ADD",
          relatedThoughtIds: [],
          reason: "Independent durable fact",
          replacementContent: null,
          metadata: {
            type: "reference",
            topics: ["Atlas Memory", "migration", "migration", "release"],
            people: ["Noam"],
            actionItems: [],
            summary: "Atlas Memory uses migration ticket ATLAS-184",
          },
        }),
        candidateIds,
        "Atlas Memory v2.7.1 uses migration ticket ATLAS-184.",
      ),
    ).toEqual({
      classification: {
        action: "ADD",
        relatedThoughtIds: [],
        reason: "Independent durable fact",
      },
      metadata: {
        type: "reference",
        topics: ["Atlas Memory", "migration", "release"],
        people: ["Noam"],
        actionItems: [],
        summary: "Atlas Memory uses migration ticket ATLAS-184",
      },
    });
  });

  test("uses replacement content when normalizing transition metadata", () => {
    const analysis = parseThoughtAnalysis(
      JSON.stringify({
        action: "SUPERSEDE",
        relatedThoughtIds: ["old-school"],
        reason: "Zevin changed schools",
        replacementContent:
          "Zevin attends Redwood Academy and previously attended Lakeside School.",
        metadata: {
          type: "not-a-type",
          topics: ["school"],
          people: ["Zevin", 42],
          actionItems: [],
          summary: "",
        },
      }),
      candidateIds,
      "Zevin now attends Redwood Academy.",
    );

    expect(analysis?.classification.action).toBe("SUPERSEDE");
    expect(analysis?.metadata).toEqual({
      ...fallbackThoughtMetadata(
        "Zevin attends Redwood Academy and previously attended Lakeside School.",
      ),
      topics: ["school"],
      people: ["Zevin"],
    });
  });

  test("fails closed on invalid JSON or an ungrounded transition id", () => {
    expect(
      parseThoughtAnalysis("not json", candidateIds, "New fact"),
    ).toBeNull();
    expect(
      parseThoughtAnalysis(
        JSON.stringify({
          action: "RETRACT",
          relatedThoughtIds: ["invented-id"],
          reason: "Correction",
          replacementContent: "Corrected fact",
          metadata: {},
        }),
        candidateIds,
        "Corrected fact",
      ),
    ).toBeNull();
  });

  test("bounds and normalizes metadata supplied by a model", () => {
    const long = "x".repeat(400);
    expect(
      normalizeThoughtMetadata(
        {
          type: "person_note",
          topics: [" one ", "one", "two", "three", "four"],
          people: Array.from({ length: 12 }, (_, index) => `Person ${index}`),
          actionItems: [long],
          summary: long,
        },
        "Fallback",
      ),
    ).toMatchObject({
      type: "person_note",
      topics: ["one", "two", "three"],
      people: Array.from({ length: 10 }, (_, index) => `Person ${index}`),
      actionItems: ["x".repeat(200)],
      summary: "x".repeat(240),
    });
  });

  test("rejects empty or oversized captures before provider calls", () => {
    expect(normalizeCaptureContent("  durable fact  ")).toBe("durable fact");
    expect(() => normalizeCaptureContent("   ")).toThrow(
      "Memory content must contain",
    );
    expect(() =>
      normalizeCaptureContent("x".repeat(MAX_CAPTURE_CONTENT_CHARS + 1)),
    ).toThrow("Memory content must contain");
  });

  test("reuses embeddings only when the stored text is unchanged", () => {
    expect(canReuseEmbedding("same", "same")).toBe(true);
    expect(canReuseEmbedding("new fact", "new fact with history")).toBe(false);
  });
});
