import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearGeneratedOutput,
  escapeFenceCell,
  isoDate,
  parseConvexRunOutput,
  renderEntityPage,
  renderFactsFence,
  renderFrontmatter,
  renderThoughtPage,
  slugify,
  thoughtFileName,
  uniqueSlug,
  yamlScalar,
} from "./export-brain.mjs";

describe("slugs", () => {
  test("normalizes accents, punctuation, and case", () => {
    assert.equal(slugify("Sara Smucker Barnwell"), "sara-smucker-barnwell");
    assert.equal(slugify("Zoë's Café"), "zoes-cafe");
    assert.equal(slugify("  --weird-- "), "weird");
  });

  test("never returns an empty slug", () => {
    assert.equal(slugify(""), "untitled");
    assert.equal(slugify("!!!"), "untitled");
    assert.equal(slugify(undefined), "untitled");
  });

  test("disambiguates collisions instead of overwriting a page", () => {
    const taken = new Set();
    assert.equal(uniqueSlug("acme", taken), "acme");
    assert.equal(uniqueSlug("acme", taken), "acme-2");
    assert.equal(uniqueSlug("acme", taken), "acme-3");
  });
});

describe("fence cells", () => {
  test("escapes pipes so one claim cannot corrupt every later column", () => {
    assert.equal(escapeFenceCell("a | b"), "a \\| b");
  });

  test("flattens newlines so a claim cannot end the row early", () => {
    assert.equal(escapeFenceCell("line one\nline two"), "line one line two");
  });
});

describe("dates", () => {
  test("renders a timestamp as a plain date", () => {
    assert.equal(isoDate(Date.UTC(2026, 6, 20)), "2026-07-20");
  });

  test("renders missing or invalid values as empty", () => {
    assert.equal(isoDate(undefined), "");
    assert.equal(isoDate(Number.NaN), "");
  });
});

describe("frontmatter", () => {
  test("omits empty values rather than emitting null keys", () => {
    const yaml = renderFrontmatter({
      type: "note",
      title: "A memory",
      people: [],
      status: undefined,
    });
    assert.equal(yaml, "---\ntype: note\ntitle: A memory\n---");
  });

  test("quotes values YAML would otherwise read as structure", () => {
    const yaml = renderFrontmatter({ title: "Decision: pick Convex" });
    assert.ok(yaml.includes('title: "Decision: pick Convex"'));
  });
});

describe("facts fence", () => {
  const base = {
    _id: "f1",
    statement: "Peter — therapist: Sara.",
    confidence: 1,
    status: "current",
    validFrom: Date.UTC(2026, 6, 20),
    sourceType: "user_confirmed",
  };

  test("renders a current fact as an active row", () => {
    const fence = renderFactsFence([base]);
    assert.ok(fence.includes("<!--- gbrain:facts:begin -->"));
    assert.ok(fence.includes("| 1 | Peter — therapist: Sara. | fact | 1 |"));
    assert.ok(!fence.includes("~~"));
  });

  test("marks a superseded fact struck and points at its replacement row", () => {
    // The lifecycle mapping is the whole point: flattening it would hand the
    // importer two competing current claims instead of one retired one.
    const fence = renderFactsFence(
      [
        { ...base, _id: "old", status: "superseded", supersededBy: "new" },
        { ...base, _id: "new", statement: "Peter — therapist: Alex." },
      ],
      { rowNumbersById: new Map([["new", 2]]) },
    );
    assert.ok(fence.includes("~~Peter — therapist: Sara.~~"));
    assert.ok(fence.includes("superseded by #2"));
  });

  test("marks a retracted fact forgotten, carrying its reason", () => {
    const fence = renderFactsFence([
      {
        ...base,
        status: "retracted",
        changeReason: "misheard the name",
      },
    ]);
    assert.ok(fence.includes("~~Peter — therapist: Sara.~~"));
    assert.ok(fence.includes("forgotten: misheard the name"));
  });

  test("defaults visibility to private for personal memory", () => {
    // GBrain's default is brain-wide: every connected agent could recall it.
    assert.ok(renderFactsFence([base]).includes("| private |"));
  });

  test("marks core facts as high notability", () => {
    assert.ok(
      renderFactsFence([{ ...base, isCore: true }]).includes("| high |"),
    );
    assert.ok(renderFactsFence([base]).includes("| medium |"));
  });

  test("renders nothing for an entity with no facts", () => {
    assert.equal(renderFactsFence([]), "");
  });
});

describe("entity pages", () => {
  test("carries type, title, aliases, and the fence", () => {
    const page = renderEntityPage(
      {
        _id: "e1",
        kind: "person",
        canonicalName: "Sara Smucker Barnwell",
        aliases: ["Sara Smucker"],
        key: "person:sara",
      },
      [
        {
          _id: "f1",
          statement: "Sara — role: therapist.",
          status: "current",
          confidence: 1,
        },
      ],
    );
    assert.ok(page.startsWith("---\ntype: person\n"));
    assert.ok(page.includes("title: Sara Smucker Barnwell"));
    assert.ok(page.includes("aliases: [Sara Smucker]"));
    assert.ok(page.includes("# Sara Smucker Barnwell"));
    assert.ok(page.includes("## Facts"));
  });

  test("maps organizations to companies and other to concepts", () => {
    const org = renderEntityPage(
      { _id: "e2", kind: "organization", canonicalName: "Acme", aliases: [] },
      [],
    );
    assert.ok(org.includes("type: company"));
    const other = renderEntityPage(
      { _id: "e3", kind: "other", canonicalName: "Thing", aliases: [] },
      [],
    );
    assert.ok(other.includes("type: concept"));
  });
});

describe("memory pages", () => {
  const thought = {
    _id: "t1",
    _creationTime: Date.UTC(2026, 8, 1),
    content: "Decided to keep AI Brain as the single memory layer.",
    metadata: {
      type: "decision",
      topics: ["memory"],
      people: ["Peter Brown"],
      actionItems: ["Run the bake-off"],
      summary: "Single memory layer",
    },
  };

  test("renders frontmatter, body, and open items", () => {
    const page = renderThoughtPage(thought);
    assert.ok(page.includes("type: note"));
    assert.ok(page.includes("brain_type: decision"));
    assert.ok(page.includes("date: 2026-09-01"));
    assert.ok(page.includes("people: [Peter Brown]"));
    assert.ok(page.includes("## Open items"));
    assert.ok(page.includes("- [ ] Run the bake-off"));
  });

  test("stamps status only when the memory is not current", () => {
    assert.ok(!renderThoughtPage(thought).includes("status:"));
    assert.ok(
      renderThoughtPage({ ...thought, memoryStatus: "retracted" }).includes(
        "status: retracted",
      ),
    );
  });

  test("maps a meeting note to a meeting page", () => {
    const page = renderThoughtPage({
      ...thought,
      metadata: { ...thought.metadata, type: "meeting_note" },
    });
    assert.ok(page.includes("type: meeting"));
  });

  test("names files by date and summary, disambiguating collisions", () => {
    const taken = new Set();
    assert.equal(
      thoughtFileName(thought, taken),
      "2026-09-01-single-memory-layer",
    );
    assert.equal(
      thoughtFileName(thought, taken),
      "2026-09-01-single-memory-layer-2",
    );
  });
});

describe("convex run output", () => {
  test("reads the result when the backend logged first", () => {
    const parsed = parseConvexRunOutput(
      'log line one\nlog line two\n{"rows":[],"isDone":true}',
    );
    assert.deepEqual(parsed, { rows: [], isDone: true });
  });

  test("reads a bare result with no logs", () => {
    assert.deepEqual(parseConvexRunOutput('{"a":1}'), { a: 1 });
  });

  test("fails loudly rather than returning nothing", () => {
    assert.throws(() => parseConvexRunOutput(""), /no output/);
    assert.throws(
      () => parseConvexRunOutput("just a log line"),
      /did not return JSON/,
    );
  });
});

describe("yaml scalars", () => {
  test("leaves a date unquoted so it stays a date after import", () => {
    assert.equal(yamlScalar("2026-09-01"), "2026-09-01");
  });

  test("leaves a plain word-led value unquoted", () => {
    assert.equal(yamlScalar("note"), "note");
    assert.equal(yamlScalar("A memory about Sara"), "A memory about Sara");
    assert.equal(yamlScalar("people/sara-smucker"), "people/sara-smucker");
  });

  test("quotes a value that starts with structure", () => {
    assert.equal(yamlScalar("- not a list"), '"- not a list"');
  });

  test("quotes commas and brackets so a flow array keeps one element", () => {
    // The regression this guards: `people: [Doe, John]` is two people.
    assert.equal(yamlScalar("Doe, John"), '"Doe, John"');
    assert.equal(yamlScalar("draft [v2]"), '"draft [v2]"');
    assert.equal(yamlScalar("a}b"), '"a}b"');
    assert.equal(
      renderFrontmatter({ people: ["Doe, John", "Ann"] }),
      '---\npeople: ["Doe, John", Ann]\n---',
    );
  });

  test("quotes values YAML would otherwise retype", () => {
    for (const literal of ["true", "False", "yes", "no", "null", "~", "on"]) {
      assert.equal(yamlScalar(literal), `"${literal}"`, literal);
    }
    assert.equal(yamlScalar("42"), '"42"');
    assert.equal(yamlScalar("3.14"), '"3.14"');
    assert.equal(yamlScalar("1e3"), '"1e3"');
    assert.equal(yamlScalar("0x1F"), '"0x1F"');
  });

  test("escapes newlines, tabs, quotes, and backslashes", () => {
    assert.equal(yamlScalar("one\ntwo"), '"one\\ntwo"');
    assert.equal(yamlScalar("a\tb"), '"a\\tb"');
    assert.equal(yamlScalar('say "hi"'), '"say \\"hi\\""');
    assert.equal(yamlScalar("C:\\path"), '"C:\\\\path"');
  });

  test("quotes non-ASCII and other punctuation rather than guessing", () => {
    assert.equal(yamlScalar("Zoë"), '"Zoë"');
    assert.equal(yamlScalar("what?"), '"what?"');
    assert.equal(yamlScalar(" padded"), '" padded"');
    assert.equal(yamlScalar(""), '""');
  });
});

describe("output directory", () => {
  test("clears only the generated directories, keeping everything else", () => {
    const out = mkdtempSync(join(tmpdir(), "export-brain-"));
    try {
      mkdirSync(join(out, "markdown", "memories"), { recursive: true });
      writeFileSync(join(out, "markdown", "memories", "stale.md"), "old");
      mkdirSync(join(out, "json"), { recursive: true });
      writeFileSync(join(out, "json", "thoughts.json"), "[]");
      writeFileSync(join(out, "notes.txt"), "mine");

      clearGeneratedOutput(out, "markdown");
      // A page that is no longer exported must not survive into the next
      // import as though it were current.
      assert.equal(existsSync(join(out, "markdown")), false);
      assert.equal(existsSync(join(out, "json", "thoughts.json")), true);
      assert.equal(existsSync(join(out, "notes.txt")), true);

      clearGeneratedOutput(out, "both");
      assert.equal(existsSync(join(out, "json")), false);
      assert.equal(existsSync(join(out, "notes.txt")), true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("tolerates a destination that does not exist yet", () => {
    assert.doesNotThrow(() =>
      clearGeneratedOutput(join(tmpdir(), "export-brain-never-made"), "both"),
    );
  });
});

describe("entity prose body", () => {
  const entity = {
    _id: "e1",
    kind: "person",
    canonicalName: "Dana Whitfield",
    aliases: ["Dana"],
  };
  const facts = [
    {
      _id: "f1",
      statement: "Dana Whitfield — employer: Halberd.",
      status: "current",
      confidence: 1,
    },
    {
      _id: "f2",
      statement: "Dana Whitfield — city: Fairhaven.",
      status: "retracted",
      changeReason: "wrong person",
      confidence: 1,
    },
  ];

  test("restates current facts as prose so the page is retrievable", async () => {
    // Without a prose body the only chunk is table syntax: verified against
    // GBrain, which returned the fence header row as the page's search snippet.
    const { renderEntityProse } = await import("./export-brain.mjs");
    const prose = renderEntityProse(entity, facts);
    assert.ok(prose.includes("Also known as Dana."));
    assert.ok(prose.includes("Dana Whitfield — employer: Halberd."));
  });

  test("keeps retired claims out of the retrievable body", async () => {
    const { renderEntityProse } = await import("./export-brain.mjs");
    const prose = renderEntityProse(entity, facts);
    assert.ok(!prose.includes("Fairhaven"));
  });

  test("puts the prose ahead of the fence in the page", async () => {
    const page = renderEntityPage(entity, facts);
    assert.ok(page.indexOf("employer: Halberd") < page.indexOf("## Facts"));
    // and the retracted claim still reaches the fence, struck through
    assert.ok(page.includes("~~Dana Whitfield — city: Fairhaven.~~"));
  });
});

describe("graph links", () => {
  const entities = [
    {
      _id: "e1",
      kind: "person",
      canonicalName: "Dana Whitfield",
      aliases: ["Dana"],
    },
    { _id: "e2", kind: "person", canonicalName: "Priya Raman", aliases: [] },
  ];

  test("emits an entity-valued fact as a wikilink so the graph can wire", async () => {
    // Verified against GBrain: without links it reports entity connected
    // coverage 0%, which disables the traversal that is its differentiator.
    const { buildPathIndex, renderEntityPage } =
      await import("./export-brain.mjs");
    const { pathById } = buildPathIndex(entities);
    const page = renderEntityPage(
      entities[1],
      [
        {
          _id: "f1",
          statement: "Priya Raman — reporting_manager: Dana Whitfield.",
          status: "current",
          confidence: 1,
          value: { type: "entity", entityId: "e1" },
        },
      ],
      { pathById },
    );
    assert.ok(page.includes("[[people/dana-whitfield]]"));
  });

  test("does not wire a link from a retired fact", async () => {
    const { buildPathIndex, renderEntityPage } =
      await import("./export-brain.mjs");
    const { pathById } = buildPathIndex(entities);
    const page = renderEntityPage(
      entities[1],
      [
        {
          _id: "f1",
          statement: "Priya Raman — reporting_manager: Dana Whitfield.",
          status: "retracted",
          confidence: 1,
          value: { type: "entity", entityId: "e1" },
        },
      ],
      { pathById },
    );
    assert.ok(!page.includes("[[people/dana-whitfield]]"));
  });

  test("links people named on a memory to their entity pages", async () => {
    const { buildPathIndex } = await import("./export-brain.mjs");
    const { pathByName } = buildPathIndex(entities);
    const page = renderThoughtPage(
      {
        _id: "t1",
        _creationTime: Date.UTC(2026, 5, 18),
        content: "Quarterly review.",
        metadata: {
          type: "meeting_note",
          topics: [],
          people: ["Dana Whitfield"],
          actionItems: [],
          summary: "Review",
        },
      },
      { pathByName },
    );
    assert.ok(page.includes("[[people/dana-whitfield|Dana Whitfield]]"));
  });

  test("resolves a person named by alias", async () => {
    const { buildPathIndex } = await import("./export-brain.mjs");
    const { pathByName } = buildPathIndex(entities);
    assert.equal(pathByName.get("dana"), "people/dana-whitfield");
  });

  test("a canonical name is never stolen by another entity's alias", async () => {
    const { buildPathIndex } = await import("./export-brain.mjs");
    const { pathByName } = buildPathIndex([
      { _id: "a", kind: "person", canonicalName: "Alex Chen", aliases: [] },
      {
        _id: "b",
        kind: "person",
        canonicalName: "Alexandra Poole",
        aliases: ["Alex Chen"],
      },
    ]);
    assert.equal(pathByName.get("alex chen"), "people/alex-chen");
  });

  test("leaves an unknown person as plain text rather than a dead link", async () => {
    const { buildPathIndex } = await import("./export-brain.mjs");
    const { pathByName } = buildPathIndex(entities);
    const page = renderThoughtPage(
      {
        _id: "t2",
        _creationTime: Date.UTC(2026, 5, 18),
        content: "Call.",
        metadata: {
          type: "meeting_note",
          topics: [],
          people: ["Someone Unknown"],
          actionItems: [],
          summary: "Call",
        },
      },
      { pathByName },
    );
    assert.ok(!page.includes("[["));
  });
});
