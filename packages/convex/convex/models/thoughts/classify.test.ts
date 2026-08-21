import { describe, expect, test } from "vitest";

import { SIMILARITY_THRESHOLD } from "./classify";

// Cosine scores measured in production against one real correction: a narrow
// statement that Discourse cannot silently hold a post with auto-restore,
// contradicting a 2,957-character decision memory that described exactly that.
// The correction was stored as a new memory instead of retracting the memory it
// refutes, because the refuted memory scored below the threshold and never
// reached the classifier. Anything that moves the threshold has to keep this
// partition intact, or corrections silently become additions again.
const MEASURED = [
  { score: 0.7544, candidate: true, of: "the passage the correction contradicts" },
  { score: 0.7415, candidate: true, of: "the contradicted memory's own summary" },
  { score: 0.6557, candidate: true, of: "the contradicted memory, full stored text" },
  { score: 0.6507, candidate: true, of: "an adjacent decision on the same project" },
  { score: 0.5451, candidate: false, of: "a related setting the correction leaves true" },
  { score: 0.4796, candidate: false, of: "related project state, not contradicted" },
  { score: 0.1666, candidate: false, of: "an unrelated project" },
];

describe("classification candidate threshold", () => {
  test("admits the memory a correction refutes without admitting the merely related", () => {
    for (const { score, candidate, of } of MEASURED) {
      expect(
        { of, candidate: score >= SIMILARITY_THRESHOLD },
        `score ${score} for ${of}`,
      ).toEqual({ of, candidate });
    }
  });
});
