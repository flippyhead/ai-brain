#!/usr/bin/env node

/**
 * Skill->tool drift check.
 *
 * Scans every SKILL.md under plugins/ai-brain/skills/ and every .mjs hook
 * under plugins/ai-brain/hooks/ for references to `mcp__ai-brain__<tool>`
 * (skills) or bare tool names in `tools/call` params (hooks).
 *
 * Reads the registered tool names from apps/web/src/lib/mcp/tools.ts.
 *
 * Exits 0 if every referenced tool is registered.
 * Exits 1 and prints offenders if any skill or hook references an
 * unregistered tool.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readRegisteredTools() {
  const toolsPath = join(repoRoot, "apps/web/src/lib/mcp/tools.ts");
  const src = await readFile(toolsPath, "utf-8");
  const blockMatch = src.match(/MCP_TOOL_NAMES\s*=\s*\{([\s\S]*?)\}/);
  if (!blockMatch) {
    throw new Error(`Could not find MCP_TOOL_NAMES block in ${toolsPath}`);
  }
  // Match string values inside MCP_TOOL_NAMES: e.g. searchThoughts: "search_thoughts"
  const regex = /:\s*"([a-z0-9_]+)"/g;
  const registered = new Set();
  let match;
  while ((match = regex.exec(blockMatch[1])) !== null) {
    registered.add(match[1]);
  }
  if (registered.size === 0) {
    throw new Error(`No tools extracted from ${toolsPath}`);
  }
  return registered;
}

/**
 * Tools registered under MCP_TOOL_PROFILE=memory. Skills may legitimately use
 * tools outside this set — the default profile is "full" — but a deployment
 * that narrows the profile loses them, so the check reports the gap.
 */
async function readMemoryProfileTools() {
  const policyPath = join(repoRoot, "apps/web/src/lib/mcp/tool-policy.ts");
  const src = await readFile(policyPath, "utf-8");
  const blockMatch = src.match(/MCP_MEMORY_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
  if (!blockMatch) {
    throw new Error(
      `Could not find MCP_MEMORY_TOOL_NAMES block in ${policyPath}`,
    );
  }
  // Entries are MCP_TOOL_NAMES.<key> references; resolve them via tools.ts.
  const keyRegex = /MCP_TOOL_NAMES\.([A-Za-z0-9_]+)/g;
  const toolsSrc = await readFile(
    join(repoRoot, "apps/web/src/lib/mcp/tools.ts"),
    "utf-8",
  );
  const byKey = new Map();
  const entryRegex = /([A-Za-z0-9_]+):\s*"([a-z0-9_]+)"/g;
  let entry;
  while ((entry = entryRegex.exec(toolsSrc)) !== null) {
    byKey.set(entry[1], entry[2]);
  }

  const memoryTools = new Set();
  let match;
  while ((match = keyRegex.exec(blockMatch[1])) !== null) {
    const name = byKey.get(match[1]);
    if (name) memoryTools.add(name);
  }
  if (memoryTools.size === 0) {
    throw new Error(`No memory-profile tools extracted from ${policyPath}`);
  }
  return memoryTools;
}

async function collectSkillFiles() {
  const skillsRoot = join(repoRoot, "plugins/ai-brain/skills");
  const skillDirs = await readdir(skillsRoot);
  const files = [];
  for (const dir of skillDirs) {
    const skillFile = join(skillsRoot, dir, "SKILL.md");
    try {
      await readFile(skillFile, "utf-8");
      files.push(skillFile);
    } catch {
      // Skip if SKILL.md missing — not this check's job
    }
  }
  return files;
}

async function collectHookFiles() {
  const hooksRoot = join(repoRoot, "plugins/ai-brain/hooks");
  const entries = await readdir(hooksRoot);
  return entries
    .filter((e) => e.endsWith(".mjs") && !e.endsWith(".test.mjs"))
    .map((e) => join(hooksRoot, e));
}

function extractSkillToolRefs(src) {
  // Matches mcp__ai-brain__<tool_name> with tool names being snake_case (digits allowed)
  const regex = /mcp__ai-brain__([a-z0-9_]+)/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

function extractHookToolRefs(src) {
  // Only match `name: "tool_name"` when preceded by `method: "tools/call"` within the same call params.
  const regex = /method:\s*"tools\/call"[\s\S]{0,500}?name:\s*"([a-z0-9_]+)"/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

async function main() {
  const registered = await readRegisteredTools();
  const memoryProfileTools = await readMemoryProfileTools();
  const skills = await collectSkillFiles();
  const hooks = await collectHookFiles();

  const offenders = [];
  const outsideMemoryProfile = [];

  const record = (file, refs) => {
    for (const ref of refs) {
      if (!registered.has(ref)) {
        offenders.push({ file, tool: ref });
      } else if (!memoryProfileTools.has(ref)) {
        outsideMemoryProfile.push({ file, tool: ref });
      }
    }
  };

  for (const skill of skills) {
    record(skill, extractSkillToolRefs(await readFile(skill, "utf-8")));
  }

  for (const hook of hooks) {
    record(hook, extractHookToolRefs(await readFile(hook, "utf-8")));
  }

  if (offenders.length > 0) {
    console.error("Skill->tool drift detected:");
    for (const { file, tool } of offenders) {
      const rel = file.replace(repoRoot + "/", "");
      console.error(`  ${rel}: references unregistered tool "${tool}"`);
    }
    console.error(`\nRegistered tools: ${[...registered].sort().join(", ")}`);
    process.exit(1);
  }

  if (outsideMemoryProfile.length > 0) {
    console.warn(
      "\nNote: these references resolve under the default MCP_TOOL_PROFILE=full",
    );
    console.warn("but are unavailable when the profile is narrowed to memory:");
    for (const { file, tool } of outsideMemoryProfile) {
      const rel = file.replace(repoRoot + "/", "");
      console.warn(`  ${rel}: "${tool}"`);
    }
  }

  console.log(
    `Skill->tool drift check passed (${skills.length} skills, ${hooks.length} hooks, ${registered.size} registered tools, ${memoryProfileTools.size} in memory profile)`,
  );
}

main().catch((err) => {
  console.error("Drift check failed to run:", err);
  process.exit(2);
});
