import { describe, expect, test } from "vitest";

import {
  assertValidMemoryValidity,
  isCurrentMemory,
  isMemoryActive,
  isMemoryRetrievable,
  parseMemoryClassification,
  safeSupersededValidTo,
} from "./memoryLifecycle";

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

  test("uses half-open validity windows for active memory", () => {
    const at = 200;
    expect(isMemoryActive({}, at)).toBe(true);
    expect(isMemoryActive({ memoryStatus: "current" }, at)).toBe(true);
    expect(isMemoryActive({ validFrom: at }, at)).toBe(true);
    expect(isMemoryActive({ validFrom: at + 1 }, at)).toBe(false);
    expect(isMemoryActive({ validTo: at }, at)).toBe(false);
    expect(isMemoryActive({ validTo: at + 1 }, at)).toBe(true);
    expect(
      isMemoryActive(
        { memoryStatus: "superseded", validFrom: 100, validTo: 300 },
        at,
      ),
    ).toBe(false);
  });

  test("validates open and closed business-time intervals", () => {
    expect(() => assertValidMemoryValidity({})).not.toThrow();
    expect(() =>
      assertValidMemoryValidity({ validFrom: 100, validTo: 200 }),
    ).not.toThrow();
    expect(() =>
      assertValidMemoryValidity({ validFrom: 200, validTo: 200 }),
    ).toThrow("Invalid memory validity interval");
    expect(() => assertValidMemoryValidity({ validFrom: Number.NaN })).toThrow(
      "Invalid memory validity interval",
    );
  });

  test("only closes a safe, open superseded interval", () => {
    expect(safeSupersededValidTo({}, 200)).toBe(200);
    expect(safeSupersededValidTo({ validFrom: 100 }, 200)).toBe(200);
    expect(
      safeSupersededValidTo({ validFrom: 100, validTo: 150 }, 200),
    ).toBeUndefined();
    expect(safeSupersededValidTo({ validFrom: 200 }, 200)).toBeUndefined();
    expect(safeSupersededValidTo({ validFrom: 300 }, 200)).toBeUndefined();
    expect(
      safeSupersededValidTo({ validFrom: 100 }, undefined),
    ).toBeUndefined();
  });
});

describe("isMemoryRetrievable", () => {
  const at = 1_000;

  test("returns current memories in both modes", () => {
    const memory = { memoryStatus: "current" as const };
    expect(isMemoryRetrievable(memory, false, at)).toBe(true);
    expect(isMemoryRetrievable(memory, true, at)).toBe(true);
  });

  test("returns superseded memories only for historical reads", () => {
    const memory = { memoryStatus: "superseded" as const };
    expect(isMemoryRetrievable(memory, false, at)).toBe(false);
    expect(isMemoryRetrievable(memory, true, at)).toBe(true);
  });

  test("withholds retracted memories from historical reads", () => {
    const memory = { memoryStatus: "retracted" as const };
    expect(isMemoryRetrievable(memory, false, at)).toBe(false);
    expect(isMemoryRetrievable(memory, true, at)).toBe(false);
  });

  test("respects business-time validity for non-historical reads", () => {
    const expired = { memoryStatus: "current" as const, validTo: 500 };
    expect(isMemoryRetrievable(expired, false, at)).toBe(false);
    expect(isMemoryRetrievable(expired, true, at)).toBe(true);
  });

  test("returns scheduled memories to historical reads but not current ones", () => {
    // A not-yet-effective memory states something accurate about a later point
    // in time, so the audit view shows it. This is deliberately unlike a
    // retracted memory, which was never accurate at any point.
    const scheduled = { memoryStatus: "current" as const, validFrom: 5_000 };
    expect(isMemoryRetrievable(scheduled, false, at)).toBe(false);
    expect(isMemoryRetrievable(scheduled, true, at)).toBe(true);
  });
});
