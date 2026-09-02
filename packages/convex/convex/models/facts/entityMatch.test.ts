import { describe, expect, test } from "vitest";

import {
  MAX_ENTITY_CANDIDATES,
  MAX_ENTITY_NAME_WORDS,
  extractEntityCandidates,
  normalizeEntityText,
} from "./entityMatch";

describe("entity candidates in a query", () => {
  test("keeps capitalised words and drops the ones that open a sentence", () => {
    expect(
      extractEntityCandidates("Where does Zevin go to school now?"),
    ).toEqual(["zevin"]);
    expect(extractEntityCandidates("Who is Priya?")).toEqual(["priya"]);
  });

  test("offers a multi-word name whole before its parts", () => {
    expect(
      extractEntityCandidates(
        "What is still outstanding with Delgado Mechanical?",
      ),
    ).toEqual(["delgado mechanical", "delgado", "mechanical"]);
  });

  test("normalizes casing, hyphens, and underscores the way names are stored", () => {
    // A hyphenated word is one token, so it is offered whole and not split.
    expect(extractEntityCandidates("Any news from FOSTER-CLARITY?")).toEqual([
      "foster clarity",
    ]);
    expect(extractEntityCandidates("Any news from Foster Clarity?")).toEqual([
      "foster clarity",
      "foster",
      "clarity",
    ]);
    expect(normalizeEntityText("  Foster_Clarity ")).toBe("foster clarity");
    expect(normalizeEntityText("Ｆoster")).toBe("foster");
  });

  test("strips punctuation and possessives without splitting the name", () => {
    expect(
      extractEntityCandidates(
        "What will Zevin's tuition come to (per Redwood Academy), and when?",
      ),
    ).toEqual(["redwood academy", "zevin", "redwood", "academy"]);
    expect(extractEntityCandidates("Is “Marisol” back yet? Ask Tom.")).toEqual([
      "marisol",
      "tom",
    ]);
  });

  test("drops the imperative a request opens with", () => {
    expect(extractEntityCandidates("Remind Priya about the invoice")).toEqual([
      "priya",
    ]);
    expect(extractEntityCandidates("Schedule Tomas for Thursday")).toEqual([
      "tomas",
      "thursday",
    ]);
  });

  test("keeps a lowercase connector inside a name but never at its edge", () => {
    expect(
      extractEntityCandidates("Call the Bank of Fernwood tomorrow"),
    ).toEqual(["bank of fernwood", "bank", "fernwood"]);
  });

  test("keeps names in a list or across a sentence break apart", () => {
    expect(
      extractEntityCandidates("Compare Alice, Bob, Carol, Dave, Erin"),
    ).toEqual(["alice", "bob", "carol", "dave", "erin"]);
    expect(extractEntityCandidates("Ask Marisol. Tomas is next.")).toEqual([
      "marisol",
      "tomas",
    ]);
    expect(extractEntityCandidates("Ping (Priya) and [Tom]")).toEqual([
      "priya",
      "tom",
    ]);
  });

  test("breaks a run at a lowercase word so unrelated names stay apart", () => {
    expect(
      extractEntityCandidates("Tell Priya that Tomas is covering"),
    ).toEqual(["priya", "tomas"]);
  });

  test("names within a run are cut at the longest a name can be", () => {
    const run = "Alpha Bravo Charlie Delta Echo Foxtrot";
    const candidates = extractEntityCandidates(run, 100);
    expect(
      candidates.every((c) => c.split(" ").length <= MAX_ENTITY_NAME_WORDS),
    ).toBe(true);
    expect(candidates[0]).toBe("alpha bravo charlie delta");
    expect(candidates).not.toContain(run.toLowerCase());
  });

  test("yields nothing for a query with no capitalised words", () => {
    expect(extractEntityCandidates("what should i cook for dinner")).toEqual(
      [],
    );
    expect(extractEntityCandidates("   ")).toEqual([]);
  });

  test("stays under the candidate cap on a long query", () => {
    const names = Array.from(
      { length: 400 },
      (_, i) => `Person${i} Surname${i}`,
    );
    const query = names.map((name) => `Then I met ${name} again.`).join(" ");
    expect(query.length).toBeGreaterThan(12_000);
    const candidates = extractEntityCandidates(query);
    expect(candidates).toHaveLength(MAX_ENTITY_CANDIDATES);
    // The cap keeps one whole name per person before any of their parts.
    expect(candidates.every((c) => c.split(" ").length === 2)).toBe(true);
  });

  test("never repeats a candidate", () => {
    const candidates = extractEntityCandidates(
      "Priya asked Priya about Priya Desai and Priya",
    );
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
