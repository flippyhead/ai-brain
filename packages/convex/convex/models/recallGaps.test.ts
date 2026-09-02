import { describe, expect, test } from "vitest";

import {
  computeRecallGaps,
  formatRecallGaps,
  MAX_RECALL_GAPS,
  STALE_AFTER_MS,
  type GapFact,
  type GapThought,
  type RecallGap,
} from "./recallGaps";

const NOW = Date.UTC(2026, 8, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

const avery = { key: "person:avery", name: "Avery", aliases: ["Ave"] };
const zevin = { key: "person:zevin", name: "Zevin", aliases: [] };

function fact(
  id: string,
  subject: GapFact["subject"],
  predicate: string,
  value: string,
  overrides: Partial<GapFact> = {},
): GapFact {
  return {
    id,
    subject,
    predicate,
    value: { type: "text", value },
    statement: `${subject?.name ?? "Someone"} — ${predicate.replaceAll("_", " ")}: ${value}.`,
    status: "current",
    createdAt: NOW - 3 * DAY,
    ...overrides,
  };
}

function thought(
  id: string,
  content: string,
  overrides: Partial<GapThought> = {},
): GapThought {
  return {
    id,
    content,
    memoryStatus: "current",
    createdAt: NOW - 2 * DAY,
    ...overrides,
  };
}

function gaps(input: {
  query?: string;
  coreFacts?: GapFact[];
  relevanceFacts?: GapFact[];
  thoughts?: GapThought[];
  now?: number;
}) {
  return computeRecallGaps({
    query: input.query ?? "What is going on with Atlas Memory?",
    coreFacts: input.coreFacts ?? [],
    relevanceFacts: input.relevanceFacts ?? [],
    thoughts: input.thoughts ?? [],
    now: input.now ?? NOW,
  });
}

/** Every id a gap cites must also appear in its message, and vice versa. */
function expectCited(gap: RecallGap) {
  const inMessage = gap.message.match(/(?:fact|thought):[A-Za-z0-9_-]+/g) ?? [];
  expect(new Set(inMessage)).toEqual(new Set(gap.refs ?? []));
}

describe("a clean window", () => {
  test("produces no gaps", () => {
    const result = gaps({
      query: "Where does Zevin go to school now?",
      coreFacts: [fact("core", avery, "dietary_restriction", "vegetarian")],
      relevanceFacts: [fact("school", zevin, "school", "Redwood Academy")],
      thoughts: [thought("t1", "Zevin currently attends Redwood Academy.")],
    });
    expect(result).toEqual([]);
  });
});

describe("empty", () => {
  test("reports a window with no relevant memory at all", () => {
    expect(gaps({})).toEqual([
      { kind: "empty", message: "Nothing in memory matched this question." },
    ]);
  });

  test("names the core fact as context rather than an answer, with a citation", () => {
    const [gap] = gaps({
      coreFacts: [fact("core", avery, "home_city", "Fernwood")],
    });
    expect(gap).toMatchObject({ kind: "empty", refs: ["fact:core"] });
    expect(gap!.message).toContain("core context (fact:core)");
    expectCited(gap!);
  });

  test("does not pile absence or staleness on an empty window", () => {
    const result = gaps({
      query: "What is Avery's phone number?",
      coreFacts: [
        fact("core", avery, "home_city", "Fernwood", {
          createdAt: NOW - 400 * DAY,
        }),
      ],
    });
    expect(result.map((gap) => gap.kind)).toEqual(["empty"]);
  });
});

describe("stale", () => {
  test("reports the newest relevant memory when it is older than the threshold", () => {
    const newest = NOW - STALE_AFTER_MS - 30 * DAY;
    const [gap] = gaps({
      relevanceFacts: [
        fact("old-fact", avery, "role", "maintainer", {
          createdAt: newest - 10 * DAY,
        }),
      ],
      thoughts: [
        thought("old-thought", "Atlas Memory is on v2.7.1.", {
          createdAt: newest,
        }),
      ],
    });
    expect(gap).toMatchObject({ kind: "stale", refs: ["thought:old-thought"] });
    expect(gap!.message).toBe(
      "Nothing relevant has been recorded since 2026-06-22 (2 months ago); the newest memory here is thought:old-thought.",
    );
    expectCited(gap!);
  });

  test("counts a re-confirmed fact by its update, and stays quiet inside the threshold", () => {
    expect(
      gaps({
        relevanceFacts: [
          fact("touched", avery, "role", "maintainer", {
            createdAt: NOW - 300 * DAY,
            updatedAt: NOW - 5 * DAY,
          }),
        ],
      }),
    ).toEqual([]);
    expect(
      gaps({
        thoughts: [thought("edge", "x", { createdAt: NOW - STALE_AFTER_MS })],
      }),
    ).toEqual([]);
  });

  test("ignores core facts, which are not relevant to the question", () => {
    const result = gaps({
      coreFacts: [fact("core", avery, "home_city", "Fernwood")],
      thoughts: [thought("old", "x", { createdAt: NOW - 100 * DAY })],
    });
    expect(result.map((gap) => gap.kind)).toEqual(["stale"]);
    expect(result[0]!.refs).toEqual(["thought:old"]);
  });

  test("reports ages in days, weeks, months, and years", () => {
    const at = (age: number) =>
      gaps({ thoughts: [thought("t", "x", { createdAt: NOW - age })] })[0]!
        .message;
    expect(at(50 * DAY)).toContain("(7 weeks ago)");
    expect(at(100 * DAY)).toContain("(3 months ago)");
    expect(at(800 * DAY)).toContain("(2 years ago)");
  });
});

describe("conflict", () => {
  test("reports two current facts that disagree on one subject and predicate", () => {
    const [gap] = gaps({
      relevanceFacts: [
        fact("a", avery, "blood_type", "A negative"),
        fact("b", avery, "blood_type", "O negative"),
      ],
    });
    expect(gap).toMatchObject({ kind: "conflict", refs: ["fact:a", "fact:b"] });
    expect(gap!.message).toBe(
      'Two current facts disagree on Avery blood type: "Avery — blood type: A negative." (fact:a) and "Avery — blood type: O negative." (fact:b).',
    );
    expectCited(gap!);
  });

  test("treats a core fact and a relevance fact as one window", () => {
    const result = gaps({
      coreFacts: [fact("a", avery, "home_city", "Fernwood")],
      relevanceFacts: [fact("b", avery, "home_city", "Brightwater")],
    });
    expect(result.map((gap) => gap.kind)).toEqual(["conflict"]);
  });

  test("does not report the same value stored twice, a different subject, or a superseded value", () => {
    expect(
      gaps({
        relevanceFacts: [
          fact("a", avery, "blood_type", "A negative"),
          fact("b", avery, "blood_type", "a negative"),
          fact("c", zevin, "blood_type", "O negative"),
          fact("d", avery, "blood_type", "O negative", {
            status: "superseded",
          }),
        ],
      }),
    ).toEqual([]);
  });

  test("compares entity, number, and datetime values by identity, not by text", () => {
    const entityFact = (id: string, entityId: string) =>
      fact(id, avery, "primary_care_provider", "x", {
        value: { type: "entity", entity: { id: entityId, name: "Dr. Ruiz" } },
      });
    expect(
      gaps({ relevanceFacts: [entityFact("a", "e1"), entityFact("b", "e1")] }),
    ).toEqual([]);
    expect(
      gaps({ relevanceFacts: [entityFact("a", "e1"), entityFact("b", "e2")] }),
    ).toHaveLength(1);
    expect(
      gaps({
        relevanceFacts: [
          fact("a", avery, "height", "", {
            value: { type: "number", value: 180, unit: "cm" },
          }),
          fact("b", avery, "height", "", {
            value: { type: "number", value: 180, unit: "in" },
          }),
        ],
      }),
    ).toHaveLength(1);
  });

  test("reports a current fact whose validity has lapsed with nothing replacing it", () => {
    const validTo = NOW - 10 * DAY;
    const [gap] = gaps({
      relevanceFacts: [
        fact("lapsed", zevin, "school", "Lakeside School", { validTo }),
      ],
    });
    expect(gap).toMatchObject({ kind: "conflict", refs: ["fact:lapsed"] });
    expect(gap!.message).toContain("stopped being valid on 2026-08-23");
    expectCited(gap!);

    // With an active replacement in the window, the lapsed fact is history.
    expect(
      gaps({
        relevanceFacts: [
          fact("lapsed", zevin, "school", "Lakeside School", { validTo }),
          fact("current", zevin, "school", "Redwood Academy", {
            validFrom: validTo,
          }),
        ],
      }),
    ).toEqual([]);
  });

  test("reports a current thought still carrying a superseded fact's value", () => {
    const [gap] = gaps({
      relevanceFacts: [
        fact("new", zevin, "school", "Redwood Academy"),
        fact("old", zevin, "school", "Lakeside School", {
          status: "superseded",
        }),
      ],
      thoughts: [thought("echo", "Zevin attends Lakeside School.")],
    });
    expect(gap).toMatchObject({
      kind: "conflict",
      refs: ["thought:echo", "fact:old", "fact:new"],
    });
    expect(gap!.message).toContain('still carries "Lakeside School"');
    expectCited(gap!);
  });

  test("does not flag a thought that states both the old and the current value", () => {
    expect(
      gaps({
        relevanceFacts: [
          fact("new", zevin, "school", "Redwood Academy"),
          fact("old", zevin, "school", "Lakeside School", {
            status: "superseded",
          }),
        ],
        thoughts: [
          thought(
            "history",
            "Zevin attends Redwood Academy; he previously attended Lakeside School.",
          ),
        ],
      }),
    ).toEqual([]);
  });
});

describe("absent", () => {
  test("reports an attribute the question asks for that no fact records for the named subject", () => {
    const result = gaps({
      query: "What's Avery's phone number?",
      coreFacts: [fact("core", avery, "home_city", "Fernwood")],
      relevanceFacts: [fact("email", avery, "email", "avery@example.test")],
      thoughts: [thought("t", "Avery prefers text over calls.")],
    });
    expect(result).toEqual([
      {
        kind: "absent",
        message: "No fact recording a phone number was found for Avery.",
      },
    ]);
  });

  test("stays silent when a fact with a matching predicate exists", () => {
    expect(
      gaps({
        query: "What's Avery's phone number?",
        relevanceFacts: [fact("p", avery, "mobile_phone", "555-0100")],
      }),
    ).toEqual([]);
    expect(
      gaps({
        query: "When was Zevin born?",
        relevanceFacts: [fact("d", zevin, "date_of_birth", "2018-05-01")],
      }),
    ).toEqual([]);
  });

  test("matches the subject by alias and scopes the check to that subject", () => {
    const result = gaps({
      query: "Do we have Ave's blood type?",
      relevanceFacts: [
        fact("z", zevin, "blood_type", "O negative"),
        fact("a", avery, "home_city", "Fernwood"),
      ],
    });
    expect(result).toEqual([
      {
        kind: "absent",
        message: "No fact recording a blood type was found for Avery.",
      },
    ]);
  });

  test("stays subjectless when the question names nobody in the window", () => {
    const result = gaps({
      query: "What is Marisol's phone number?",
      relevanceFacts: [fact("a", avery, "home_city", "Fernwood")],
      thoughts: [thought("t", "Delgado Mechanical services the furnace.")],
    });
    expect(result).toEqual([
      {
        kind: "absent",
        message:
          "No fact recording a phone number was found for this question.",
      },
    ]);
  });

  test("does not read a substring as a name or an email address as a postal one", () => {
    const eve = { key: "person:eve", name: "Eve", aliases: [] };
    const window = {
      relevanceFacts: [fact("e", eve, "email", "eve@example.test")],
    };
    expect(gaps({ query: "What is Eve's address?", ...window })).toEqual([
      {
        kind: "absent",
        message: "No fact recording an address was found for Eve.",
      },
    ]);
    expect(gaps({ query: "What is Steven's address?", ...window })).toEqual([
      {
        kind: "absent",
        message: "No fact recording an address was found for this question.",
      },
    ]);
    expect(gaps({ query: "What is Eve's email address?", ...window })).toEqual(
      [],
    );
  });

  test("carries no citation, because there is nothing to cite", () => {
    for (const gap of gaps({
      query: "Where does Zevin go to school and who is his doctor?",
      relevanceFacts: [fact("a", zevin, "home_city", "Fernwood")],
    })) {
      expect(gap.kind).toBe("absent");
      expect(gap.refs).toBeUndefined();
      expect(gap.message).not.toMatch(/(?:fact|thought):/);
    }
  });
});

describe("bounds and ordering", () => {
  test("caps the count and keeps the most actionable kinds", () => {
    const old = NOW - 200 * DAY;
    const result = gaps({
      query:
        "What are Avery's phone number, email, address, birthday, and blood type?",
      relevanceFacts: [
        fact("a", avery, "home_city", "Fernwood", { createdAt: old }),
        fact("b", avery, "home_city", "Brightwater", { createdAt: old }),
      ],
    });
    expect(result).toHaveLength(MAX_RECALL_GAPS);
    expect(result[0]!.kind).toBe("conflict");
    expect(result.slice(1).every((gap) => gap.kind === "absent")).toBe(true);
  });

  test("orders conflict before absent before stale", () => {
    const result = gaps({
      query: "What is Avery's phone number?",
      relevanceFacts: [
        fact("a", avery, "home_city", "Fernwood", {
          createdAt: NOW - 200 * DAY,
        }),
        fact("b", avery, "home_city", "Brightwater", {
          createdAt: NOW - 200 * DAY,
        }),
      ],
    });
    expect(result.map((gap) => gap.kind)).toEqual([
      "conflict",
      "absent",
      "stale",
    ]);
  });

  test("is deterministic for the same input", () => {
    const input = {
      query: "What is Avery's phone number?",
      relevanceFacts: [
        fact("a", avery, "home_city", "Fernwood", {
          createdAt: NOW - 200 * DAY,
        }),
      ],
    };
    expect(gaps(input)).toEqual(gaps(input));
  });
});

describe("formatRecallGaps", () => {
  test("renders one bullet per gap under a heading", () => {
    expect(
      formatRecallGaps([
        { kind: "stale", message: "Old (thought:t).", refs: ["thought:t"] },
        { kind: "absent", message: "Nothing on phone." },
      ]),
    ).toBe(
      "What the brain doesn't know:\n- [stale] Old (thought:t).\n- [absent] Nothing on phone.",
    );
  });
});
