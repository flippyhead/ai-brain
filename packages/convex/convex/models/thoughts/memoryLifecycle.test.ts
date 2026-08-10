import { describe, expect, test } from "vitest";

import { isCurrentMemory, parseMemoryClassification } from "./memoryLifecycle";

const candidates = ["old-school", "other-memory"];

describe("temporal memory classification", () => {
  test("keeps independent information as a new current memory", () => {
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "ADD",
          relatedThoughtIds: ["old-school"],
          reason: "This is a separate durable fact",
        }),
        candidates,
      ),
    ).toEqual({
      action: "ADD",
      relatedThoughtIds: [],
      reason: "This is a separate durable fact",
    });
  });

  test("recognizes information that is already captured", () => {
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "NOOP",
          relatedThoughtIds: ["old-school"],
          reason: "The fact is already stored",
        }),
        candidates,
      ),
    ).toEqual({
      action: "NOOP",
      relatedThoughtIds: ["old-school"],
      reason: "The fact is already stored",
    });
  });

  test("preserves a former school while creating a standalone current memory", () => {
    expect(
      parseMemoryClassification(
        [
          "```json",
          "{",
          '  "action": "SUPERSEDE",',
          '  "relatedThoughtIds": ["old-school"],',
          '  "reason": "Zevin changed schools",',
          '  "replacementContent": "Zevin currently attends Redwood Academy. He previously attended Lakeside School."',
          "}",
          "```",
        ].join("\n"),
        candidates,
      ),
    ).toEqual({
      action: "SUPERSEDE",
      relatedThoughtIds: ["old-school"],
      reason: "Zevin changed schools",
      replacementContent:
        "Zevin currently attends Redwood Academy. He previously attended Lakeside School.",
    });
  });

  test("distinguishes a correction from a fact that was once true", () => {
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "RETRACT",
          relatedThoughtIds: ["old-school"],
          reason: "The earlier school name was incorrect",
          replacementContent:
            "Correction: Zevin attends Redwood Academy; the earlier reference to Lakeside was inaccurate.",
        }),
        candidates,
      )?.action,
    ).toBe("RETRACT");
  });

  test("fails closed on destructive, hallucinated, or incomplete output", () => {
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "DELETE",
          relatedThoughtIds: ["old-school"],
          reason: "Remove it",
        }),
        candidates,
      ),
    ).toBeNull();
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "SUPERSEDE",
          relatedThoughtIds: ["unknown-id"],
          reason: "Changed",
          replacementContent: "New value",
        }),
        candidates,
      ),
    ).toBeNull();
    expect(
      parseMemoryClassification(
        JSON.stringify({
          action: "SUPERSEDE",
          relatedThoughtIds: ["old-school"],
          reason: "Changed",
        }),
        candidates,
      ),
    ).toBeNull();
  });

  test("treats legacy memories without a status as current", () => {
    expect(isCurrentMemory(undefined)).toBe(true);
    expect(isCurrentMemory("current")).toBe(true);
    expect(isCurrentMemory("superseded")).toBe(false);
    expect(isCurrentMemory("retracted")).toBe(false);
  });
});
