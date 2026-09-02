#!/usr/bin/env node

/**
 * Export an account's memories out of this deployment.
 *
 * Two formats, for two different jobs:
 *
 *   --format json      A faithful archive. Every stored field except the
 *                      embedding, unaltered, one file per collection. This is
 *                      the backup and the thing to re-import from.
 *
 *                      Reports and insights are archived here too; they are not
 *                      memories the markdown brain can use, but they are the
 *                      account's data and a backup that drops them is partial.
 *
 *   --format markdown  A GBrain-shaped brain directory: entity pages carrying a
 *                      `## Facts` fence, memory pages carrying frontmatter.
 *                      Lossy by construction — it is a translation, not an
 *                      archive — but faithful about lifecycle, which is the
 *                      part a comparison would otherwise get wrong.
 *
 * Reads through `convex run` with a deployment key, so the operator's existing
 * Convex auth is the only credential involved and this script never handles a
 * key itself.
 *
 * Usage:
 *   node scripts/export-brain.mjs --out ./brain-export [options]
 *
 *   --out <dir>            Destination directory (required)
 *   --format json|markdown|both   Default: both
 *   --user <userId>        Account to export. Omit to list accounts and stop.
 *   --include-historical   Include superseded and retracted memories
 *   --prod                 Read the production deployment
 *   --page-size <n>        Rows per read (default 100, max 500)
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every account-owned table. Must match `EXPORT_COLLECTIONS` in
 * `packages/convex/convex/models/export/model.ts`; the deployment rejects a
 * name it does not know, so drift fails loudly rather than silently omitting
 * a table from the archive.
 */
export const COLLECTIONS = [
  "entities",
  "facts",
  "thoughts",
  "lists",
  "listItems",
  "reports",
  "insights",
];

/** The subdirectories this script generates under `--out`, one per format. */
export const FORMAT_DIRECTORIES = { json: "json", markdown: "markdown" };

/**
 * GBrain files entity pages by directory, and the directory is what its filing
 * rules key on. `other` lands in concepts/ because that is where GBrain puts a
 * named thing that is not a person, company, or project.
 */
export const ENTITY_DIRECTORIES = {
  person: "people",
  organization: "companies",
  project: "projects",
  place: "places",
  other: "concepts",
};

export const ENTITY_PAGE_TYPES = {
  person: "person",
  organization: "company",
  project: "project",
  place: "concept",
  other: "concept",
};

/**
 * AI Brain's narrative types onto GBrain's page types. `note` is the honest
 * fallback: inventing a closer-looking type would make the import read as more
 * structured than it is. The original type is preserved in frontmatter as
 * `brain_type` so nothing is lost in translation.
 */
export const THOUGHT_PAGE_TYPES = {
  decision: "note",
  person_note: "person",
  idea: "note",
  meeting_note: "meeting",
  task: "note",
  reference: "note",
  procedural: "note",
};

export function slugify(value, { maxLength = 60 } = {}) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** Make a slug unique within a directory without silently overwriting a page. */
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let suffix = 2;
  while (taken.has(`${slug}-${suffix}`)) suffix += 1;
  const unique = `${slug}-${suffix}`;
  taken.add(unique);
  return unique;
}

export function isoDate(milliseconds) {
  if (typeof milliseconds !== "number" || Number.isNaN(milliseconds)) return "";
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/**
 * A fence cell is one markdown table cell. A raw pipe would end it early and a
 * newline would end the row, so both have to go before the text is written —
 * otherwise one memory containing a pipe silently corrupts every column after
 * it, and the importer reads garbage without erroring.
 */
export function escapeFenceCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * Plain YAML scalars this script is willing to emit unquoted. Everything else
 * is double-quoted and escaped, so the rule is an allow-list rather than a
 * list of characters YAML happens to treat specially — a list that would have
 * to be complete to be safe, in both block and flow context, and was not.
 *
 * Two shapes are allowed through:
 *
 *   - An ISO date. Left bare on purpose so it stays a date after import; quoting
 *     it turns a `date` field into a string the importer cannot sort on.
 *   - A word-led string of letters, digits, spaces, and `_ . / -`, with no
 *     leading or trailing space. That is a plain scalar in every YAML context
 *     and cannot be read as a number, a boolean, or null.
 *
 * `Doe, John`, `[draft]`, `true`, `42`, `null`, and anything with a newline
 * all fall through to quoting, which is the point.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAIN_WORD = /^[A-Za-z_][A-Za-z0-9_./-]*(?: [A-Za-z0-9_./-]+)*$/;
const YAML_KEYWORDS = new Set([
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
  "null",
  "y",
  "n",
]);

export function yamlScalar(value) {
  const text = String(value ?? "");
  if (ISO_DATE.test(text)) return text;
  if (PLAIN_WORD.test(text) && !YAML_KEYWORDS.has(text.toLowerCase())) {
    return text;
  }
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\r?\n/g, "\\n");
  return `"${escaped}"`;
}

export function renderFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.map(yamlScalar).join(", ")}]`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

const FENCE_HEADER = [
  "| # | claim | kind | confidence | visibility | notability | valid_from | valid_until | source | context |",
  "|---|-------|------|------------|------------|------------|------------|-------------|--------|---------|",
];

/**
 * Render facts as a GBrain `## Facts` fence.
 *
 * The lifecycle mapping is the point of this function, and it is exact rather
 * than approximate:
 *
 *   superseded here  → `~~claim~~` with context `superseded by #N`
 *   retracted here   → `~~claim~~` with context `forgotten: <changeReason>`
 *
 * Those are GBrain's own two strikethrough cases, so a superseded fact arrives
 * as superseded rather than as a second competing current claim. An import that
 * flattened lifecycle would hand GBrain a brain full of contradictions and then
 * blame it for the contradictions.
 *
 * Visibility defaults to `private`: this is personal memory, and GBrain's
 * brain-wide default would expose it to every agent connected to that brain.
 */
export function renderFactsFence(facts, { rowNumbersById = new Map() } = {}) {
  if (facts.length === 0) return "";
  const rows = facts.map((fact, index) => {
    const rowNumber = index + 1;
    const active = fact.status === "current";
    const claim = escapeFenceCell(fact.statement);
    let context = "";
    if (fact.status === "superseded") {
      const target = rowNumbersById.get(fact.supersededBy);
      context = target ? `superseded by #${target}` : "superseded";
    } else if (fact.status === "retracted") {
      context = fact.changeReason
        ? `forgotten: ${escapeFenceCell(fact.changeReason)}`
        : "forgotten: retracted as inaccurate";
    }
    return [
      rowNumber,
      active ? claim : `~~${claim}~~`,
      "fact",
      typeof fact.confidence === "number" ? fact.confidence : 1,
      "private",
      fact.isCore ? "high" : "medium",
      isoDate(fact.validFrom),
      isoDate(fact.validTo),
      escapeFenceCell(fact.sourceRef ?? fact.sourceType ?? ""),
      context,
    ].join(" | ");
  });

  return [
    "## Facts",
    "",
    "<!--- gbrain:facts:begin -->",
    ...FENCE_HEADER,
    ...rows.map((row) => `| ${row} |`),
    "<!--- gbrain:facts:end -->",
    "",
  ].join("\n");
}

/**
 * Prose restatement of an entity's current facts, in the entity page body.
 *
 * Without this the page body is a heading followed by a fence, and a fence is a
 * markdown table — so the only chunk a retriever gets is table syntax, and the
 * page matches nothing and previews as `| # | claim | kind | ...`. Verified
 * against GBrain: entity pages exported without a prose body returned the fence
 * header as their search snippet.
 *
 * The statements are reproduced verbatim, never summarised. Retired claims are
 * deliberately excluded — they belong in the fence, struck through, where the
 * importer reads their lifecycle. Restating them as prose would put retracted
 * text back into the retrievable body, which is the exact failure the
 * strikethrough exists to prevent.
 */
export function renderEntityProse(entity, facts) {
  const lines = [];
  if (entity.aliases?.length) {
    lines.push(`Also known as ${entity.aliases.join(", ")}.`);
  }
  const current = facts.filter((fact) => fact.status === "current");
  for (const fact of current) {
    lines.push(String(fact.statement ?? "").trim());
  }
  return lines.filter(Boolean).join("\n\n");
}

/**
 * Obsidian-style wikilink, the form GBrain's link extractor reads.
 *
 * Entity references have to be emitted as links, not as plain text. AI Brain
 * stores `primary_care_provider → person:sara` as a typed reference between two
 * entities; written out as prose it becomes an ordinary sentence, and the graph
 * that reference belongs to never gets built. Verified against GBrain: an export
 * without wikilinks reports `graph_coverage: entity connected coverage 0%`,
 * which silently disables the traversal that is GBrain's whole differentiator.
 */
export function wikilink(path, label) {
  return label && label !== path ? `[[${path}|${label}]]` : `[[${path}]]`;
}

export function entityPagePath(entity) {
  const directory = ENTITY_DIRECTORIES[entity.kind] ?? "concepts";
  return `${directory}/${slugify(entity.canonicalName)}`;
}

/**
 * Wikilinks for every entity this entity's current facts point at, so the
 * relationships AI Brain stores as typed references survive as graph edges.
 */
export function renderEntityLinks(facts, pathById) {
  if (!pathById) return "";
  const seen = new Set();
  for (const fact of facts) {
    if (fact.status !== "current") continue;
    const value = fact.value;
    if (value?.type !== "entity" || !value.entityId) continue;
    const target = pathById.get(value.entityId);
    if (target) seen.add(target);
  }
  if (seen.size === 0) return "";
  return [
    "## Related",
    "",
    ...[...seen].map((path) => `- ${wikilink(path)}`),
  ].join("\n");
}

export function renderEntityPage(entity, facts, { pathById } = {}) {
  const rowNumbersById = new Map(
    facts.map((fact, index) => [fact._id, index + 1]),
  );
  const frontmatter = renderFrontmatter({
    type: ENTITY_PAGE_TYPES[entity.kind] ?? "concept",
    title: entity.canonicalName,
    aliases: entity.aliases,
    brain_entity_key: entity.key,
  });
  const prose = renderEntityProse(entity, facts);
  const links = renderEntityLinks(facts, pathById);
  const fence = renderFactsFence(facts, { rowNumbersById });
  const body = [`# ${entity.canonicalName}`, prose, links, fence]
    .filter(Boolean)
    .join("\n\n");
  return `${frontmatter}\n\n${body}`.trimEnd() + "\n";
}

export function renderThoughtPage(thought, { pathByName } = {}) {
  const metadata = thought.metadata ?? {};
  const status = thought.memoryStatus ?? "current";
  const frontmatter = renderFrontmatter({
    type: THOUGHT_PAGE_TYPES[metadata.type] ?? "note",
    title: metadata.summary || thought.content.slice(0, 80),
    date: isoDate(thought.validFrom ?? thought._creationTime),
    people: metadata.people,
    tags: metadata.topics,
    brain_type: metadata.type,
    brain_id: thought._id,
    // Only stamped when it is not "current", so a normal page stays clean and a
    // retired one is unmistakable to both a reader and a grep.
    status: status === "current" ? undefined : status,
    valid_from: isoDate(thought.validFrom),
    valid_to: isoDate(thought.validTo),
    source: thought.sourceRef ?? thought.sourceType,
  });

  const sections = [frontmatter, "", thought.content.trim()];

  // The people on a memory are the edges between it and their entity pages.
  // Left as bare names in frontmatter they are strings; as wikilinks they let
  // "what is open with this person" become a graph walk rather than a search.
  const people = (metadata.people ?? [])
    .map((name) => {
      const path = pathByName?.get(normalizeName(name));
      return path ? `- ${wikilink(path, name)}` : null;
    })
    .filter(Boolean);
  if (people.length > 0) {
    sections.push("", "## People", "", ...people);
  }

  if (Array.isArray(metadata.actionItems) && metadata.actionItems.length > 0) {
    sections.push(
      "",
      "## Open items",
      "",
      ...metadata.actionItems.map((item) => `- [ ] ${item}`),
    );
  }
  return sections.join("\n").trimEnd() + "\n";
}

/** Match a memory's free-text person name against an entity name or alias. */
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** name and alias → page path, for resolving people named on a memory. */
export function buildPathIndex(entities) {
  const pathById = new Map();
  const pathByName = new Map();
  for (const entity of entities) {
    const path = entityPagePath(entity);
    pathById.set(entity._id, path);
    pathByName.set(normalizeName(entity.canonicalName), path);
    for (const alias of entity.aliases ?? []) {
      const key = normalizeName(alias);
      // Canonical names win: an alias must never steal a name another entity
      // owns outright, or a memory wires to the wrong person.
      if (!pathByName.has(key)) pathByName.set(key, path);
    }
  }
  for (const entity of entities) {
    pathByName.set(normalizeName(entity.canonicalName), entityPagePath(entity));
  }
  return { pathById, pathByName };
}

export function thoughtFileName(thought, taken) {
  const metadata = thought.metadata ?? {};
  const date = isoDate(thought.validFrom ?? thought._creationTime);
  const base = slugify(metadata.summary || thought.content.slice(0, 80));
  return uniqueSlug(date ? `${date}-${base}` : base, taken);
}

/**
 * `convex run` prints deployment log lines before its result. Parsing the whole
 * stream as JSON fails the moment the backend logs anything, so take the last
 * complete JSON value instead.
 */
export function parseConvexRunOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (text === "") throw new Error("convex run produced no output");
  const start = Math.min(
    ...[text.lastIndexOf("\n{"), text.lastIndexOf("\n[")]
      .map((index) => (index === -1 ? Infinity : index + 1))
      .concat(text.startsWith("{") || text.startsWith("[") ? [0] : []),
  );
  if (!Number.isFinite(start)) {
    throw new Error(`convex run did not return JSON:\n${text.slice(0, 400)}`);
  }
  return JSON.parse(text.slice(start));
}

function convexRun(fn, args, { prod }) {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@repo/db",
      "exec",
      "convex",
      "run",
      fn,
      JSON.stringify(args),
      ...(prod ? ["--prod"] : []),
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `convex run ${fn} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return parseConvexRunOutput(result.stdout);
}

/**
 * Walk a paged internal query to the end, handing each page to `onPage`.
 * Loops on `isDone`, never on the page's contents: a page of entirely
 * superseded memories filters to nothing and is not the end of the collection.
 */
function eachPage(fn, args, options, onPage) {
  let after;
  for (;;) {
    const page = convexRun(
      fn,
      { ...args, ...(after === undefined ? {} : { after }) },
      options,
    );
    onPage(page);
    if (page.isDone) break;
    after = page.cursor;
    if (after === null || after === undefined) break;
  }
}

function readCollection(collection, options) {
  const rows = [];
  eachPage(
    "models/export/private:collectionPage",
    {
      userId: options.userId,
      collection,
      pageSize: options.pageSize,
      includeHistorical: options.includeHistorical,
    },
    options,
    (page) => rows.push(...page.rows),
  );
  return rows;
}

/**
 * Row counts per collection, summed over bounded pages. This is a second,
 * independent pass over the same rows: the export pass filters by lifecycle
 * and the count pass does not, so `exported === counts.current` is a real
 * check that no page was dropped rather than one number copied into another.
 */
function readCounts(options) {
  const counts = {};
  for (const collection of COLLECTIONS) {
    const sum = { total: 0, current: 0 };
    eachPage(
      "models/export/private:countPage",
      { userId: options.userId, collection, pageSize: options.pageSize },
      options,
      (page) => {
        sum.total += page.total;
        sum.current += page.current;
      },
    );
    counts[collection] = sum;
  }
  return counts;
}

function readAccounts(options) {
  const accounts = [];
  eachPage("models/export/private:listAccounts", {}, options, (page) =>
    accounts.push(...page.accounts),
  );
  return accounts;
}

function formatBoundedCount({ count, capped }) {
  return capped ? `${count}+` : String(count);
}

function parseArguments(argv) {
  const options = {
    format: "both",
    pageSize: 100,
    includeHistorical: false,
    prod: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => argv[(index += 1)];
    if (flag === "--out") options.out = next();
    else if (flag === "--format") options.format = next();
    else if (flag === "--user") options.userId = next();
    else if (flag === "--page-size") options.pageSize = Number(next());
    else if (flag === "--include-historical") options.includeHistorical = true;
    else if (flag === "--prod") options.prod = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!["json", "markdown", "both"].includes(options.format)) {
    throw new Error(`--format must be json, markdown, or both`);
  }
  return options;
}

function write(directory, relativePath, contents) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/**
 * Remove the generated directories for the formats about to be written, so a
 * re-export into the same `--out` cannot leave behind pages from an earlier
 * run. Without this, a memory retracted since the last export keeps its file,
 * and the next import reads it as current — the one thing an export must not
 * get wrong. Only this script's own `json/` and `markdown/` subdirectories are
 * touched; anything else under `--out` is left alone.
 */
export function clearGeneratedOutput(out, format) {
  const formats = format === "both" ? ["json", "markdown"] : [format];
  for (const name of formats) {
    rmSync(join(out, FORMAT_DIRECTORIES[name]), {
      recursive: true,
      force: true,
    });
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));

  if (!options.userId) {
    const accounts = readAccounts(options);
    console.log("Accounts on this deployment:\n");
    for (const account of accounts) {
      console.log(
        `  ${account.userId}  ${account.name ?? account.email ?? "(unnamed)"}` +
          `  — ${formatBoundedCount(account.thoughts)} memories, ` +
          `${formatBoundedCount(account.facts)} facts`,
      );
    }
    console.log("\nRe-run with --user <userId> --out <dir>.");
    return;
  }
  if (!options.out) throw new Error("--out <dir> is required");

  const counts = readCounts(options);

  const data = {};
  for (const collection of COLLECTIONS) {
    data[collection] = readCollection(collection, options);
    console.log(`read ${data[collection].length} ${collection}`);
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    includeHistorical: options.includeHistorical,
    counts,
    exported: Object.fromEntries(
      COLLECTIONS.map((name) => [name, data[name].length]),
    ),
  };

  clearGeneratedOutput(options.out, options.format);

  if (options.format === "json" || options.format === "both") {
    for (const collection of COLLECTIONS) {
      write(
        join(options.out, FORMAT_DIRECTORIES.json),
        `${collection}.json`,
        JSON.stringify(data[collection], null, 2),
      );
    }
    write(
      join(options.out, FORMAT_DIRECTORIES.json),
      "manifest.json",
      JSON.stringify(manifest, null, 2),
    );
  }

  if (options.format === "markdown" || options.format === "both") {
    const root = join(options.out, FORMAT_DIRECTORIES.markdown);
    const factsByEntity = new Map();
    for (const fact of data.facts) {
      const bucket = factsByEntity.get(fact.subjectEntityId) ?? [];
      bucket.push(fact);
      factsByEntity.set(fact.subjectEntityId, bucket);
    }

    // Built before any page is written: an entity page links to other entity
    // pages, so every path has to be known before the first one is rendered.
    const { pathById, pathByName } = buildPathIndex(data.entities);

    const takenByDirectory = new Map();
    for (const entity of data.entities) {
      const directory = ENTITY_DIRECTORIES[entity.kind] ?? "concepts";
      const taken = takenByDirectory.get(directory) ?? new Set();
      takenByDirectory.set(directory, taken);
      const slug = uniqueSlug(slugify(entity.canonicalName), taken);
      write(
        root,
        join(directory, `${slug}.md`),
        renderEntityPage(entity, factsByEntity.get(entity._id) ?? [], {
          pathById,
        }),
      );
    }

    const memorySlugs = new Set();
    for (const thought of data.thoughts) {
      write(
        root,
        join("memories", `${thoughtFileName(thought, memorySlugs)}.md`),
        renderThoughtPage(thought, { pathByName }),
      );
    }
    write(root, "_manifest.json", JSON.stringify(manifest, null, 2));
  }

  console.log(`\nExported to ${options.out}`);
  console.log(
    `Memories: ${manifest.exported.thoughts} of ${counts.thoughts.total} ` +
      `(${counts.thoughts.current} current). ` +
      `Facts: ${manifest.exported.facts} of ${counts.facts.total}.`,
  );
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("export-brain.mjs");
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
