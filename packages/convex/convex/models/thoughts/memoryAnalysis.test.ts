import { describe, expect, test } from "vitest";

import {
  canReuseEmbedding,
  fallbackThoughtMetadata,
  MAX_CAPTURE_CONTENT_CHARS,
  normalizeCaptureContent,
  normalizeThoughtMetadata,
  parseThoughtAnalysis,
  preflightNarrativeAdmission,
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

  test("parses ask and skip admission decisions without transition ids", () => {
    for (const action of ["ASK", "SKIP"] as const) {
      const analysis = parseThoughtAnalysis(
        JSON.stringify({
          action,
          relatedThoughtIds: ["old-school"],
          reason:
            action === "ASK"
              ? "Route the exact school relationship to structured facts"
              : "Current age is derived and goes stale",
          replacementContent: null,
          metadata: {
            type: "person_note",
            topics: ["Zevin"],
            people: ["Zevin"],
            actionItems: [],
            summary: "Candidate not admitted",
          },
        }),
        candidateIds,
        action === "ASK"
          ? "Zevin attends Downtown School."
          : "Zevin is 17 years old.",
      );

      expect(analysis?.classification).toEqual({
        action,
        relatedThoughtIds: [],
        reason:
          action === "ASK"
            ? "Route the exact school relationship to structured facts"
            : "Current age is derived and goes stale",
      });
    }
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

  test("deterministically declines derived ages and broad bootstrap buckets", () => {
    expect(preflightNarrativeAdmission("Zevin is 17 years old.")).toEqual({
      action: "SKIP",
      reason: expect.stringContaining("date_of_birth"),
    });
    expect(
      preflightNarrativeAdmission(
        "About me: founder, investor, sailor, neighborhood blogger, generative artist, and advisor across several unrelated companies.",
      ),
    ).toEqual({
      action: "ASK",
      reason: expect.stringContaining("broad bucket"),
    });
    expect(
      preflightNarrativeAdmission(
        "AI Brain will use Convex because it provides the database and application functions in one service. The decision keeps the personal deployment simpler.",
      ),
    ).toBeNull();
  });

  test("admits one subject stated at length or as a short list", () => {
    // Length is not breadth. A decision with its rationale, and the correction
    // that later supersedes it, are both one coherent unit whose parts change
    // together — the shape the gate is meant to admit. Counting sentences or
    // bullets declined them, and because the preflight runs before the
    // classifier it also made the stale memory uncorrectable.
    expect(
      preflightNarrativeAdmission(
        "Discourse moderation now uses an approval queue on the flagged-user group. The earlier plan to hide posts silently and auto-restore them is dead because Discourse has no such primitive. Peter confirmed this on 18 August 2026. The approval queue is visible to the author, which we accepted. The backtest has now run over 90 days of flags. It showed a 4% false-positive rate, low enough to ship.",
      ),
    ).toBeNull();
    expect(
      preflightNarrativeAdmission(
        [
          "Moderation plan for the community site:",
          "- approval queue on the flagged-user group",
          "- no silent holds, Discourse cannot do it",
          "- the author sees the queue, accepted",
          "- backtest ran, 4% false positives",
        ].join("\n"),
      ),
    ).toBeNull();
  });
});

describe("structured fact coverage in the admission gate", () => {
  test("accepts a NOOP that cites a covering fact instead of a thought", () => {
    // The fact id reaches parseThoughtAnalysis through the same candidate set
    // as thought ids. If it were omitted the citation would be dropped, the
    // NOOP would be rejected as malformed, and the narrative duplicate the
    // gate just declined would be stored anyway.
    const analysis = parseThoughtAnalysis(
      JSON.stringify({
        action: "NOOP",
        relatedThoughtIds: ["fact-123"],
        reason: "Already recorded as a structured date_of_birth fact",
        replacementContent: null,
        metadata: {
          type: "person_note",
          topics: ["Zevin"],
          people: ["Zevin"],
          actionItems: [],
          summary: "Zevin's date of birth",
        },
      }),
      ["thought-1", "fact-123"],
      "Zevin was born on May 12, 2009",
    );

    expect(analysis?.classification).toMatchObject({
      action: "NOOP",
      relatedThoughtIds: ["fact-123"],
    });
  });

  test("drops a citation naming neither a candidate thought nor a covering fact", () => {
    expect(
      parseThoughtAnalysis(
        JSON.stringify({
          action: "NOOP",
          relatedThoughtIds: ["invented-id"],
          reason: "Already captured",
          replacementContent: null,
          metadata: {
            type: "reference",
            topics: [],
            people: [],
            actionItems: [],
            summary: "x",
          },
        }),
        ["thought-1", "fact-123"],
        "Some content",
      ),
    ).toBeNull();
  });
});
