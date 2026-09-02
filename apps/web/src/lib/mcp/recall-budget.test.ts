import { describe, expect, test } from "vitest";

import {
  allocateRecallBudget,
  BOUNDARY_SLACK,
  cutAtBoundary,
  MIN_EXCERPT_CHARS,
  type RecallTier,
  serializeRecallEnvelope,
  TRUNCATION_MARK,
} from "./recall-budget";

type Item = {
  id: string;
  tier: RecallTier;
  text: string;
  truncated?: true;
};

const item = (id: string, tier: RecallTier, text: string): Item => ({
  id,
  tier,
  text,
});

/** Prose with a sentence boundary every ~60 characters. */
function prose(chars: number, seed = "Memory"): string {
  const sentences: string[] = [];
  let length = 0;
  let n = 0;
  while (length < chars) {
    const sentence = `${seed} sentence ${n} says something worth keeping here.`;
    sentences.push(sentence);
    length += sentence.length + 1;
    n += 1;
  }
  return sentences.join(" ").slice(0, chars);
}

function allocate(items: Item[], budget: number) {
  return allocateRecallBudget<Item>(items, {
    budget,
    tierOf: (i) => i.tier,
    textOf: (i) => i.text,
    withText: (i, text, truncated) => ({
      ...i,
      text,
      ...(truncated ? { truncated: true as const } : {}),
    }),
  });
}

/** The smallest text a trimmed item can keep, ellipsis excluded. */
const MIN_KEPT_CHARS =
  Math.ceil(MIN_EXCERPT_CHARS * (1 - BOUNDARY_SLACK)) - TRUNCATION_MARK.length;

describe("allocateRecallBudget", () => {
  test("passes everything through untouched when it fits", () => {
    const items = [
      item("core", "core", prose(300)),
      item("a", "relevance", prose(500)),
      item("b", "relevance", prose(200)),
    ];
    const result = allocate(items, 10_000);
    expect(result.items).toEqual(items);
    expect(result).toMatchObject({ trimmed: 0, dropped: 0 });
    expect(result.usedChars).toBe(serializeRecallEnvelope(items).length);
  });

  test("trims one long item before dropping four short ones", () => {
    const items = [
      item("long", "relevance", prose(6_000)),
      item("s1", "relevance", prose(120)),
      item("s2", "relevance", prose(120)),
      item("s3", "relevance", prose(120)),
      item("s4", "relevance", prose(120)),
    ];
    const full = serializeRecallEnvelope(items).length;
    const result = allocate(items, full - 2_000);

    expect(result.items.map((i) => i.id)).toEqual([
      "long",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(result.dropped).toBe(0);
    expect(result.trimmed).toBe(1);
    expect(result.items[0]).toMatchObject({ id: "long", truncated: true });
    expect(result.items[0]?.text.length).toBeLessThan(6_000);
    expect(result.items[0]?.text.endsWith(TRUNCATION_MARK)).toBe(true);
    for (const short of result.items.slice(1)) {
      expect(short.truncated).toBeUndefined();
      expect(short.text).toBe(prose(120));
    }
    expect(result.usedChars).toBeLessThanOrEqual(full - 2_000);
  });

  test("levels the longest items down and leaves the rest alone", () => {
    const items = [
      item("a", "relevance", prose(3_000)),
      item("b", "relevance", prose(2_000)),
      item("c", "relevance", prose(400)),
    ];
    const result = allocate(items, 3_000);
    const [a, b, c] = result.items;
    expect(result.trimmed).toBe(2);
    expect(a?.truncated).toBe(true);
    expect(b?.truncated).toBe(true);
    expect(c).toEqual(items[2]);
    // Both trimmed items sit at the same water level, give or take the
    // boundary each one found.
    expect(
      Math.abs((a?.text.length ?? 0) - (b?.text.length ?? 0)),
    ).toBeLessThan(MIN_EXCERPT_CHARS * BOUNDARY_SLACK);
  });

  test("keeps core and exact whole while relevance shares the rest", () => {
    const items = [
      item("exact", "exact", prose(2_000)),
      item("core", "core", prose(2_000)),
      item("r1", "relevance", prose(2_000)),
      item("r2", "relevance", prose(2_000)),
    ];
    const result = allocate(items, 6_000);
    expect(result.items.map((i) => i.id)).toEqual([
      "exact",
      "core",
      "r1",
      "r2",
    ]);
    expect(result.items[0]).toEqual(items[0]);
    expect(result.items[1]).toEqual(items[1]);
    expect(result.items[2]?.truncated).toBe(true);
    expect(result.items[3]?.truncated).toBe(true);
    expect(result.usedChars).toBeLessThanOrEqual(6_000);
  });

  test("keeps tier and rank order whatever gets trimmed or dropped", () => {
    const items = [
      item("core", "core", prose(100)),
      item("r1", "relevance", prose(100)),
      item("r2", "relevance", prose(4_000)),
      item("r3", "relevance", prose(100)),
      item("r4", "relevance", prose(4_000)),
      item("r5", "relevance", prose(100)),
    ];
    const ids = items.map((i) => i.id);
    for (const budget of [400, 800, 1_500, 3_000, 6_000, 20_000]) {
      const result = allocate(items, budget);
      const kept = result.items.map((i) => i.id);
      // A prefix of the ranking, with each kept item in its original place.
      expect(kept).toEqual(ids.filter((id) => kept.includes(id)));
      expect(kept).toEqual(ids.slice(0, kept.length));
      expect(result.dropped).toBe(items.length - kept.length);
    }
  });

  test("never allocates a trimmed item less than the minimum excerpt", () => {
    const items = [
      item("core", "core", prose(300)),
      ...Array.from({ length: 6 }, (_, i) =>
        item(`r${i}`, "relevance", prose(3_000)),
      ),
    ];
    for (const budget of [800, 1_200, 1_600, 2_400, 4_000, 8_000]) {
      const result = allocate(items, budget);
      for (const kept of result.items) {
        if (kept.truncated) {
          expect(kept.text.length).toBeGreaterThanOrEqual(MIN_KEPT_CHARS);
        }
      }
      expect(result.usedChars).toBeLessThanOrEqual(budget);
    }
  });

  test("drops the lowest-ranked relevance item rather than shrinking every excerpt", () => {
    const items = [
      item("r1", "relevance", prose(2_000)),
      item("r2", "relevance", prose(2_000)),
      item("r3", "relevance", prose(2_000)),
    ];
    // Room for two minimum excerpts and their framing, not three.
    const result = allocate(items, 2 * (MIN_EXCERPT_CHARS + 120));
    expect(result.items.map((i) => i.id)).toEqual(["r1", "r2"]);
    expect(result.dropped).toBe(1);
    expect(result.trimmed).toBe(2);
  });

  test("never exceeds the budget, JSON overhead and escapes included", () => {
    const awkward =
      'Line one says "quoted" things.\n\nLine two has a tab\there and a backslash \\ too. ' +
      "Then a sentence with unicode — dashes and an emoji 🧠 in it. ";
    const items = [
      item("core", "core", awkward.repeat(4)),
      item("exact", "exact", awkward.repeat(2)),
      ...Array.from({ length: 6 }, (_, i) =>
        item(`r${i}`, "relevance", awkward.repeat(10 + i * 7)),
      ),
    ];
    for (let budget = 0; budget <= 12_000; budget += 97) {
      const result = allocate(items, budget);
      const serialized = serializeRecallEnvelope(result.items);
      expect(serialized.length).toBeLessThanOrEqual(budget < 2 ? 2 : budget);
      expect(result.usedChars).toBe(serialized.length);
      expect(result.maxChars).toBe(budget);
      expect(result.items.length + result.dropped).toBe(items.length);
      for (const kept of result.items) {
        // No lone surrogate halves from cutting through an emoji.
        expect(() => new TextEncoder().encode(kept.text)).not.toThrow();
        expect(JSON.stringify(kept.text)).not.toMatch(
          /\\ud[89ab][0-9a-f]{2}"$/i,
        );
      }
    }
  });

  test("returns an empty envelope for no items", () => {
    const result = allocate([], 1_000);
    expect(result).toEqual({
      items: [],
      maxChars: 1_000,
      usedChars: 2,
      trimmed: 0,
      dropped: 0,
    });
  });

  test("trims a lone giant item to the budget instead of dropping it", () => {
    const items = [item("giant", "relevance", prose(40_000))];
    const result = allocate(items, 3_000);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "giant", truncated: true });
    expect(result.usedChars).toBeLessThanOrEqual(3_000);
    expect(result.usedChars).toBeGreaterThan(2_500);
  });

  test("trims, then drops, protected tiers only when nothing else is left", () => {
    const items = [
      item("exact", "exact", prose(3_000)),
      item("core", "core", prose(3_000)),
      item("r1", "relevance", prose(3_000)),
    ];
    const trimmed = allocate(items, 1_500);
    expect(trimmed.items.map((i) => i.id)).toEqual(["exact", "core"]);
    expect(trimmed.items.every((i) => i.truncated)).toBe(true);
    expect(trimmed.dropped).toBe(1);

    const squeezed = allocate(items, 500);
    expect(squeezed.items.map((i) => i.id)).toEqual(["exact"]);
    expect(squeezed.dropped).toBe(2);
    expect(squeezed.usedChars).toBeLessThanOrEqual(500);
  });

  test("keeps protected items whole when they fit exactly once relevance is gone", () => {
    const protectedItems = [
      item("exact", "exact", prose(1_500)),
      item("core", "core", prose(1_500)),
    ];
    const items = [
      ...protectedItems,
      item("r1", "relevance", prose(2_000)),
      item("r2", "relevance", prose(2_000)),
      item("r3", "relevance", prose(2_000)),
    ];
    // Exactly the envelope of the two protected items: framing for two, not
    // for the three relevance items that have to go.
    const budget = serializeRecallEnvelope(protectedItems).length;
    const result = allocate(items, budget);
    expect(result.items).toEqual(protectedItems);
    expect(result).toMatchObject({
      trimmed: 0,
      dropped: 3,
      usedChars: budget,
      maxChars: budget,
    });
  });

  test("keeps relevance items whole when they fit exactly after a drop", () => {
    // Two short items: levelling them down for a third could not reach the
    // minimum excerpt, so the third is dropped and the framing must shrink
    // with it.
    const fitting = [
      item("r1", "relevance", prose(100)),
      item("r2", "relevance", prose(100)),
    ];
    const items = [...fitting, item("r3", "relevance", prose(2_000))];
    const budget = serializeRecallEnvelope(fitting).length;
    const result = allocate(items, budget);
    expect(result.items).toEqual(fitting);
    expect(result).toMatchObject({ trimmed: 0, dropped: 1, usedChars: budget });
  });

  test("returns nothing when the budget is below every minimum", () => {
    const items = [
      item("core", "core", prose(3_000)),
      item("r1", "relevance", prose(3_000)),
    ];
    const result = allocate(items, 100);
    expect(result.items).toEqual([]);
    expect(result.dropped).toBe(2);
    expect(result.usedChars).toBe(2);
  });
});

describe("cutAtBoundary", () => {
  test("prefers a paragraph break, then a sentence, then a word", () => {
    const paragraphs =
      "First paragraph ends here.\n\nSecond paragraph is a bit longer than the first one. It has two sentences.\n\nThird.";
    const atParagraph = cutAtBoundary(paragraphs, 105);
    expect(atParagraph).toBe(
      "First paragraph ends here.\n\nSecond paragraph is a bit longer than the first one. It has two sentences.",
    );

    const sentences =
      "One sentence here. Another sentence follows it! A third one asks a question? The fourth is cut.";
    const atSentence = cutAtBoundary(sentences, 85);
    expect(atSentence).toBe(
      "One sentence here. Another sentence follows it! A third one asks a question?",
    );

    const words = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    expect(cutAtBoundary(words, 30)).toBe("alpha beta gamma delta epsilon");
  });

  test("gives back at most the slack, else cuts hard", () => {
    const text = `${"x".repeat(50)}. ${"y".repeat(400)}`;
    const cut = cutAtBoundary(text, 300);
    // The sentence end at 51 is outside the slack window, so the cut is hard.
    expect(cut.length).toBe(300);
    expect(cut.length).toBeGreaterThanOrEqual(
      Math.ceil(300 * (1 - BOUNDARY_SLACK)),
    );
  });

  test("returns the text untouched when it fits", () => {
    expect(cutAtBoundary("short", 10)).toBe("short");
    expect(cutAtBoundary("exact", 5)).toBe("exact");
  });

  test("does not split a surrogate pair", () => {
    const text = "🧠".repeat(10);
    const cut = cutAtBoundary(text, 7);
    expect(cut).toBe("🧠🧠🧠");
  });
});
