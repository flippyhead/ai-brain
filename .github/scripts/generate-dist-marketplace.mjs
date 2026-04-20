#!/usr/bin/env node

/**
 * Generates the distribution repo's marketplace.json from the source
 * plugin's plugin.json. Writes output to the path given as argv[2].
 *
 * Ensures the distribution marketplace version always matches the
 * source plugin version — the single version source of truth is
 * plugins/ai-brain/.claude-plugin/plugin.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error(
      "Usage: generate-dist-marketplace.mjs <output-path-for-marketplace.json>",
    );
    process.exit(1);
  }

  const pluginManifest = JSON.parse(
    await readFile(
      join(repoRoot, "plugins/ai-brain/.claude-plugin/plugin.json"),
      "utf-8",
    ),
  );

  const marketplace = {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "ai-brain-plugin",
    description: "AI Brain — personal memory layer for Claude Code.",
    owner: {
      name: pluginManifest.author?.name ?? "Peter Brown",
      email: "peter@wagglelabs.com",
    },
    plugins: [
      {
        name: pluginManifest.name,
        description: pluginManifest.description,
        version: pluginManifest.version,
        author: { name: pluginManifest.author?.name ?? "Peter Brown" },
        source: "./",
      },
    ],
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(marketplace, null, 2) + "\n");

  console.log(
    `Generated ${outPath} for ${pluginManifest.name}@${pluginManifest.version}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
