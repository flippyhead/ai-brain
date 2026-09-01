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

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const COLLECTIONS = [
  "entities",
  "facts",
  "thoughts",
  "lists",
  "listItems",
];

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

export function yamlScalar(value) {
  const text = String(value ?? "");
  // Quote only what YAML would actually misread. An embedded hyphen is not
  // structure — quoting on it turns `2026-09-01` into a string, and the
  // importer then has a date field it cannot sort or filter on.
  const startsWithStructure = /^[-?:,[\]{}#&*!|>'"%@`]/.test(text);
  const containsSeparator = /:\s|\s#/.test(text);
  const paddedWithSpace = /^\s|\s$/.test(text);
  if (
    text === "" ||
    startsWithStructure ||
    containsSeparator ||
    paddedWithSpace
  ) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
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

export function renderEntityPage(entity, facts) {
  const rowNumbersById = new Map(
    facts.map((fact, index) => [fact._id, index + 1]),
  );
  const frontmatter = renderFrontmatter({
    type: ENTITY_PAGE_TYPES[entity.kind] ?? "concept",
    title: entity.canonicalName,
    aliases: entity.aliases,
    brain_entity_key: entity.key,
  });
  const fence = renderFactsFence(facts, { rowNumbersById });
  return `${frontmatter}\n\n# ${entity.canonicalName}\n\n${fence}`.trimEnd() + "\n";
}

export function renderThoughtPage(thought) {
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

function readCollection(collection, options) {
  const rows = [];
  let after;
  for (;;) {
    const page = convexRun(
      "models/export/private:collectionPage",
      {
        userId: options.userId,
        collection,
        pageSize: options.pageSize,
        includeHistorical: options.includeHistorical,
        ...(after === undefined ? {} : { after }),
      },
      options,
    );
    rows.push(...page.rows);
    // Loop on isDone, never on rows.length: a page of entirely superseded
    // memories filters to nothing and is not the end of the collection.
    if (page.isDone) break;
    after = page.cursor;
    if (after === null || after === undefined) break;
  }
  return rows;
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

function main() {
  const options = parseArguments(process.argv.slice(2));

  if (!options.userId) {
    const accounts = convexRun(
      "models/export/private:listAccounts",
      {},
      options,
    );
    console.log("Accounts on this deployment:\n");
    for (const account of accounts) {
      console.log(
        `  ${account.userId}  ${account.name ?? account.email ?? "(unnamed)"}` +
          `  — ${account.thoughts} memories, ${account.facts} facts`,
      );
    }
    console.log("\nRe-run with --user <userId> --out <dir>.");
    return;
  }
  if (!options.out) throw new Error("--out <dir> is required");

  const counts = convexRun(
    "models/export/private:counts",
    { userId: options.userId },
    options,
  );

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

  if (options.format === "json" || options.format === "both") {
    for (const collection of COLLECTIONS) {
      write(
        join(options.out, "json"),
        `${collection}.json`,
        JSON.stringify(data[collection], null, 2),
      );
    }
    write(
      join(options.out, "json"),
      "manifest.json",
      JSON.stringify(manifest, null, 2),
    );
  }

  if (options.format === "markdown" || options.format === "both") {
    const root = join(options.out, "markdown");
    const factsByEntity = new Map();
    for (const fact of data.facts) {
      const bucket = factsByEntity.get(fact.subjectEntityId) ?? [];
      bucket.push(fact);
      factsByEntity.set(fact.subjectEntityId, bucket);
    }

    const takenByDirectory = new Map();
    for (const entity of data.entities) {
      const directory = ENTITY_DIRECTORIES[entity.kind] ?? "concepts";
      const taken = takenByDirectory.get(directory) ?? new Set();
      takenByDirectory.set(directory, taken);
      const slug = uniqueSlug(slugify(entity.canonicalName), taken);
      write(
        root,
        join(directory, `${slug}.md`),
        renderEntityPage(entity, factsByEntity.get(entity._id) ?? []),
      );
    }

    const memorySlugs = new Set();
    for (const thought of data.thoughts) {
      write(
        root,
        join("memories", `${thoughtFileName(thought, memorySlugs)}.md`),
        renderThoughtPage(thought),
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
