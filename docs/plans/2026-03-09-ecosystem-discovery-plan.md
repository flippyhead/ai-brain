# Ecosystem Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ecosystem discovery to the workflow analyst so it can recommend plugins, MCP servers, and skills the user isn't using but would benefit from.

**Architecture:** A new Node.js script (`refresh-ecosystem.mjs`) reads local Claude Code files and fetches public registry data, writing a cache JSON. The analyst reads this cache during analysis and produces `ecosystem` category insights. The Convex backend and web UI need small changes to accept the new category.

**Tech Stack:** Node.js (ESM), Convex (validators/model/schema), React (InsightCard), Zod (MCP server schemas)

**Design doc:** `docs/plans/2026-03-09-ecosystem-discovery-design.md`

---

### Task 1: Add `ecosystem` to Convex Validators

**Files:**
- Modify: `packages/convex/convex/models/reports/validators.ts:3-8`

**Step 1: Add `"ecosystem"` literal to the `insightCategory` union**

Open `packages/convex/convex/models/reports/validators.ts`. The current `insightCategory` is:

```typescript
export const insightCategory = v.union(
  v.literal("feature-discovery"),
  v.literal("anti-pattern"),
  v.literal("productivity"),
  v.literal("automation"),
);
```

Change it to:

```typescript
export const insightCategory = v.union(
  v.literal("feature-discovery"),
  v.literal("anti-pattern"),
  v.literal("productivity"),
  v.literal("automation"),
  v.literal("ecosystem"),
);
```

**Step 2: Verify the change compiles**

Run: `cd packages/convex && npx convex dev --once --typecheck disable 2>&1 | tail -5`
Expected: No errors related to validators

**Step 3: Commit**

```bash
git add packages/convex/convex/models/reports/validators.ts
git commit -m "feat: add ecosystem to insight category validator"
```

---

### Task 2: Update Model Type Annotations

The `model.ts` file has hardcoded union type strings that must include `"ecosystem"`.

**Files:**
- Modify: `packages/convex/convex/models/reports/model.ts:54-59` (parameter type for `_listInsightsByUserAndStatus`)
- Modify: `packages/convex/convex/models/reports/model.ts:77-84` (parameter type for `_insertInsight`)

**Step 1: Add `"ecosystem"` to `_listInsightsByUserAndStatus` category parameter type**

In `packages/convex/convex/models/reports/model.ts`, find the `_listInsightsByUserAndStatus` function. Its `category` parameter type is:

```typescript
  category?:
    | "feature-discovery"
    | "anti-pattern"
    | "productivity"
    | "automation",
```

Change it to:

```typescript
  category?:
    | "feature-discovery"
    | "anti-pattern"
    | "productivity"
    | "automation"
    | "ecosystem",
```

**Step 2: Add `"ecosystem"` to `_insertInsight` category parameter type**

In the same file, find the `_insertInsight` function. Its `category` field type is:

```typescript
    category:
      | "feature-discovery"
      | "anti-pattern"
      | "productivity"
      | "automation";
```

Change it to:

```typescript
    category:
      | "feature-discovery"
      | "anti-pattern"
      | "productivity"
      | "automation"
      | "ecosystem";
```

**Step 3: Verify with typecheck**

Run: `cd packages/convex && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

**Step 4: Commit**

```bash
git add packages/convex/convex/models/reports/model.ts
git commit -m "feat: add ecosystem to model type annotations"
```

---

### Task 3: Add Ecosystem Color to InsightCard

**Files:**
- Modify: `apps/web/src/features/insights/components/InsightCard.tsx:8-13` (categoryColors)
- Modify: `apps/web/src/features/insights/components/InsightCard.tsx:15-20` (categoryTextColors)

**Step 1: Add ecosystem to `categoryColors`**

In `apps/web/src/features/insights/components/InsightCard.tsx`, find:

```typescript
const categoryColors: Record<string, string> = {
  "anti-pattern": "#ffebee",
  "feature-discovery": "#e3f2fd",
  productivity: "#e8f5e9",
  automation: "#f3e5f5",
};
```

Change it to:

```typescript
const categoryColors: Record<string, string> = {
  "anti-pattern": "#ffebee",
  "feature-discovery": "#e3f2fd",
  productivity: "#e8f5e9",
  automation: "#f3e5f5",
  ecosystem: "#e0f2f1",
};
```

**Step 2: Add ecosystem to `categoryTextColors`**

Find:

```typescript
const categoryTextColors: Record<string, string> = {
  "anti-pattern": "#c62828",
  "feature-discovery": "#1565c0",
  productivity: "#2e7d32",
  automation: "#6a1b9a",
};
```

Change it to:

```typescript
const categoryTextColors: Record<string, string> = {
  "anti-pattern": "#c62828",
  "feature-discovery": "#1565c0",
  productivity: "#2e7d32",
  automation: "#6a1b9a",
  ecosystem: "#00695c",
};
```

**Step 3: Verify the build**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/web/src/features/insights/components/InsightCard.tsx
git commit -m "feat: add teal color mapping for ecosystem insight category"
```

---

### Task 4: Add `ecosystem` to MCP Server Schemas

**Files:**
- Modify: `apps/web/src/lib/mcp/server.ts:237-241` (create_report insights category enum)
- Modify: `apps/web/src/lib/mcp/server.ts:286-291` (get_insights category enum)

**Step 1: Add `"ecosystem"` to `create_report` tool's category enum**

In `apps/web/src/lib/mcp/server.ts`, find the `create_report` tool definition. Inside the `insights` array schema, the `category` field is:

```typescript
            category: z.enum([
              "feature-discovery",
              "anti-pattern",
              "productivity",
              "automation",
            ]),
```

Change it to:

```typescript
            category: z.enum([
              "feature-discovery",
              "anti-pattern",
              "productivity",
              "automation",
              "ecosystem",
            ]),
```

**Step 2: Add `"ecosystem"` to `get_insights` tool's category enum**

In the same file, find the `get_insights` tool definition. The `category` field is:

```typescript
        .enum([
          "feature-discovery",
          "anti-pattern",
          "productivity",
          "automation",
        ])
```

Change it to:

```typescript
        .enum([
          "feature-discovery",
          "anti-pattern",
          "productivity",
          "automation",
          "ecosystem",
        ])
```

**Step 3: Verify the build**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/web/src/lib/mcp/server.ts
git commit -m "feat: add ecosystem to MCP server create_report and get_insights schemas"
```

---

### Task 5: Create `refresh-ecosystem.mjs` — Local Data Collection

This is the main script. We'll build it incrementally. Start with just local data (no network calls).

**Files:**
- Create: `~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs`

**Step 1: Create the script with local data collection**

Create `~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs`:

```javascript
#!/usr/bin/env node

/**
 * Refresh Ecosystem Cache
 *
 * Reads local Claude Code files and fetches public registry data.
 * Writes a cache JSON for the workflow analyst to use during analysis.
 *
 * Usage: node refresh-ecosystem.mjs [--sessions-json /path/to/sessions.json] [--history-json /path/to/history.json]
 *
 * Exit codes: always 0 (failures are logged but never fatal)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const CACHE_PATH = join(SKILLS_DIR, 'workflow-analyst', 'ecosystem-cache.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sessions-json' && args[i + 1]) {
      result.sessionsJson = args[i + 1];
      i++;
    }
    if (args[i] === '--history-json' && args[i + 1]) {
      result.historyJson = args[i + 1];
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Local: Installed plugins
// ---------------------------------------------------------------------------

function getInstalledPlugins() {
  const data = readJsonSafe(join(PLUGINS_DIR, 'installed_plugins.json'));
  if (!data?.plugins) return [];

  const installCounts = getInstallCounts();

  return Object.entries(data.plugins).map(([key, installs]) => {
    const install = Array.isArray(installs) ? installs[0] : installs;
    const [name, marketplace] = key.split('@');
    const countEntry = installCounts.find(c => c.plugin === key);
    return {
      name,
      marketplace: marketplace || 'unknown',
      version: install?.version || 'unknown',
      installs: countEntry?.unique_installs || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Local: Install counts (popularity)
// ---------------------------------------------------------------------------

function getInstallCounts() {
  const data = readJsonSafe(join(PLUGINS_DIR, 'install-counts-cache.json'));
  return data?.counts || [];
}

// ---------------------------------------------------------------------------
// Local: Available plugins from install counts
// ---------------------------------------------------------------------------

function getAvailablePlugins(installedNames) {
  const counts = getInstallCounts();
  return counts
    .filter(c => {
      const name = c.plugin.split('@')[0];
      return !installedNames.has(name) && c.unique_installs > 1000;
    })
    .map(c => {
      const [name, marketplace] = c.plugin.split('@');
      return {
        name,
        marketplace: marketplace || 'unknown',
        installs: c.unique_installs,
      };
    });
}

// ---------------------------------------------------------------------------
// Local: Installed skills
// ---------------------------------------------------------------------------

function getInstalledSkills() {
  const skills = [];
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillMd = join(SKILLS_DIR, dir.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      try {
        const content = readFileSync(skillMd, 'utf-8');
        // Parse frontmatter description
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        let description = '';
        if (match) {
          const descMatch = match[1].match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        skills.push({ name: dir.name, description });
      } catch {
        skills.push({ name: dir.name, description: '' });
      }
    }
  } catch {
    // skills dir doesn't exist
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Local: Tech stack inference from active projects
// ---------------------------------------------------------------------------

const FRAMEWORK_MAP = {
  react: 'react',
  'react-dom': 'react',
  next: 'next.js',
  vue: 'vue',
  nuxt: 'nuxt',
  angular: 'angular',
  svelte: 'svelte',
  express: 'express',
  fastify: 'fastify',
  convex: 'convex',
  prisma: 'prisma',
  drizzle: 'drizzle',
  tailwindcss: 'tailwind',
  'styled-components': 'styled-components',
  vite: 'vite',
  webpack: 'webpack',
  jest: 'jest',
  vitest: 'vitest',
  playwright: 'playwright',
  cypress: 'cypress',
  stripe: 'stripe',
  firebase: 'firebase',
  supabase: 'supabase',
};

function inferTechStack(sessionsData) {
  const techSet = new Set();
  const projectPaths = [];

  // Extract project paths from session data
  if (sessionsData?.projectBreakdown) {
    for (const projectPath of Object.keys(sessionsData.projectBreakdown)) {
      // Convert encoded path back — session parser encodes / as -
      // The path looks like /Users/peterbrown/Development/project
      // but stored as -Users-peterbrown-Development-project
      let decoded = projectPath.replace(/-/g, '/');
      if (!decoded.startsWith('/')) {
        decoded = `/${decoded}`;
      }
      if (existsSync(decoded)) {
        projectPaths.push(decoded);
      }
    }
  }

  for (const projectPath of projectPaths) {
    // package.json → Node.js / frameworks
    const pkgPath = join(projectPath, 'package.json');
    if (existsSync(pkgPath)) {
      techSet.add('typescript'); // safe assumption for Claude Code users
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        for (const [dep, _] of Object.entries(allDeps)) {
          if (FRAMEWORK_MAP[dep]) {
            techSet.add(FRAMEWORK_MAP[dep]);
          }
        }
      } catch {
        // skip
      }
    }

    // Cargo.toml → Rust
    if (existsSync(join(projectPath, 'Cargo.toml'))) {
      techSet.add('rust');
    }

    // pyproject.toml or requirements.txt → Python
    if (existsSync(join(projectPath, 'pyproject.toml')) ||
        existsSync(join(projectPath, 'requirements.txt'))) {
      techSet.add('python');
    }

    // go.mod → Go
    if (existsSync(join(projectPath, 'go.mod'))) {
      techSet.add('go');
    }
  }

  return [...techSet];
}

// ---------------------------------------------------------------------------
// Local: Prompt theme extraction
// ---------------------------------------------------------------------------

const THEME_KEYWORDS = {
  'PR review': ['review', 'pr', 'pull request', 'code review'],
  deploy: ['deploy', 'deployment', 'ship', 'release', 'publish'],
  test: ['test', 'testing', 'spec', 'coverage'],
  debug: ['debug', 'fix', 'bug', 'error', 'issue'],
  refactor: ['refactor', 'clean', 'simplify', 'reorganize'],
  docs: ['doc', 'readme', 'documentation', 'comment'],
  'UI/frontend': ['ui', 'frontend', 'component', 'css', 'style', 'design'],
  'API/backend': ['api', 'endpoint', 'server', 'backend', 'route'],
  database: ['database', 'db', 'schema', 'migration', 'query'],
  CI: ['ci', 'github actions', 'workflow', 'pipeline'],
};

function extractPromptThemes(historyData) {
  const themes = new Set();
  const prompts = historyData?.frequentPrompts || [];

  for (const { prompt, count } of prompts) {
    if (count < 2) continue;
    const lower = prompt.toLowerCase();
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        themes.add(theme);
      }
    }
  }

  return [...themes];
}

// ---------------------------------------------------------------------------
// Local: MCP server health from Cowork sessions
// ---------------------------------------------------------------------------

function getMcpServerHealth() {
  const coworkDir = join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
  const health = { connected: [], failed: [], needsAuth: [] };

  try {
    if (!existsSync(coworkDir)) return health;

    // Walk org dirs → agent dirs → find metadata JSONs
    const metadataFiles = [];
    const orgDirs = readdirSync(coworkDir, { withFileTypes: true });
    for (const orgDir of orgDirs) {
      if (!orgDir.isDirectory()) continue;
      const orgPath = join(coworkDir, orgDir.name);
      const agentDirs = readdirSync(orgPath, { withFileTypes: true });
      for (const agentDir of agentDirs) {
        if (!agentDir.isDirectory()) continue;
        const agentPath = join(orgPath, agentDir.name);
        const files = readdirSync(agentPath).filter(f => f.startsWith('local_') && f.endsWith('.json'));
        for (const f of files) {
          const fp = join(agentPath, f);
          try {
            const data = JSON.parse(readFileSync(fp, 'utf-8'));
            if (data.lastActivityAt) {
              metadataFiles.push({ path: fp, data, lastActivity: new Date(data.lastActivityAt).getTime() });
            }
          } catch {
            // skip
          }
        }
      }
    }

    if (metadataFiles.length === 0) return health;

    // Sort by most recent activity
    metadataFiles.sort((a, b) => b.lastActivity - a.lastActivity);
    const latest = metadataFiles[0].data;

    // Extract MCP server names from remoteMcpServersConfig
    const serverNames = new Set();
    if (latest.remoteMcpServersConfig) {
      for (const name of Object.keys(latest.remoteMcpServersConfig)) {
        serverNames.add(name);
      }
    }

    // Try to find the audit.jsonl for this session to get connection status
    const metaPath = metadataFiles[0].path;
    const sessionDir = metaPath.replace(/\.json$/, '');
    const auditPath = join(sessionDir, 'audit.jsonl');

    if (existsSync(auditPath)) {
      try {
        const auditContent = readFileSync(auditPath, 'utf-8');
        const firstLines = auditContent.split('\n').slice(0, 20);
        for (const line of firstLines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.mcp_servers && Array.isArray(entry.mcp_servers)) {
              for (const server of entry.mcp_servers) {
                const name = server.name || server.id;
                if (!name) continue;
                if (server.status === 'connected') health.connected.push(name);
                else if (server.status === 'failed') health.failed.push(name);
                else if (server.status === 'needs-auth') health.needsAuth.push(name);
              }
              break; // found the init entry
            }
          } catch {
            // skip
          }
        }
      } catch {
        // audit file not readable
      }
    }

    // Any servers in remoteMcpServersConfig not in health lists → connected (assumed)
    for (const name of serverNames) {
      if (!health.connected.includes(name) &&
          !health.failed.includes(name) &&
          !health.needsAuth.includes(name)) {
        health.connected.push(name);
      }
    }
  } catch {
    // cowork dir not accessible
  }

  return health;
}

// ---------------------------------------------------------------------------
// Network: Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchJsonSafe(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Network: MCP Registry servers
// ---------------------------------------------------------------------------

async function fetchMcpRegistryServers() {
  const data = await fetchJsonSafe('https://registry.modelcontextprotocol.io/v0/servers?limit=50');
  if (!data || !Array.isArray(data.servers)) return [];
  return data.servers.map(s => ({
    name: s.name || s.id,
    description: s.description || '',
    source: 'registry',
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  // Read session/history data if provided
  const sessionsData = args.sessionsJson ? readJsonSafe(args.sessionsJson) : null;
  const historyData = args.historyJson ? readJsonSafe(args.historyJson) : null;

  // Local: plugins
  const installed = getInstalledPlugins();
  const installedNames = new Set(installed.map(p => p.name));
  const available = getAvailablePlugins(installedNames);

  // Local: skills
  const installedSkills = getInstalledSkills();

  // Local: tech stack
  const techStack = inferTechStack(sessionsData);

  // Local: prompt themes
  const promptThemes = extractPromptThemes(historyData);

  // Local: MCP server health
  const mcpHealth = getMcpServerHealth();

  // Local: active projects from session data
  const activeProjects = sessionsData?.projectBreakdown
    ? Object.keys(sessionsData.projectBreakdown).map(p => {
        const parts = p.split('/');
        return parts[parts.length - 1] || p;
      })
    : [];

  // Network: MCP registry (best effort)
  const mcpServers = await fetchMcpRegistryServers();

  // Build cache
  const cache = {
    refreshedAt: new Date().toISOString(),
    userContext: {
      techStack,
      activeProjects,
      frequentPromptThemes: promptThemes,
      mcpServerHealth: mcpHealth,
    },
    plugins: {
      available,
      installed,
    },
    mcpServers: {
      available: mcpServers,
      installed: mcpHealth.connected.map(name => ({ name, source: 'cowork' })),
    },
    skills: {
      available: [], // populated by network fetch in future
      installed: installedSkills,
    },
  };

  // Write cache
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.error(`Ecosystem cache written to ${CACHE_PATH}`);
  console.log(JSON.stringify({ ok: true, plugins: available.length, mcpServers: mcpServers.length, techStack }, null, 2));
}

main().catch(err => {
  console.error('refresh-ecosystem error:', err.message);
  process.exit(0); // never fail
});
```

**Step 2: Test the script runs without errors**

Run: `node ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs`
Expected: Outputs JSON with `ok: true` and writes cache file. No crashes.

**Step 3: Verify the cache file was written**

Run: `cat ~/.claude/skills/workflow-analyst/ecosystem-cache.json | head -30`
Expected: Valid JSON with `refreshedAt`, `userContext`, `plugins`, etc.

**Step 4: Test with session data input**

Run: `node ~/.claude/skills/workflow-analyst/parse-sessions.mjs --days 7 --output /tmp/test-sessions.json && node ~/.claude/skills/workflow-analyst/parse-history.mjs --days 7 > /tmp/test-history.json && node ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs --sessions-json /tmp/test-sessions.json --history-json /tmp/test-history.json`
Expected: Outputs JSON with populated `techStack` array

**Step 5: Commit**

```bash
git add ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs
git commit -m "feat: create refresh-ecosystem.mjs for ecosystem cache"
```

---

### Task 6: Update SKILL.md — Add Step 0 and Expand Step 4

**Files:**
- Modify: `~/.claude/skills/workflow-analyst/SKILL.md`

**Step 1: Add Step 0 before the existing Step 1**

In `~/.claude/skills/workflow-analyst/SKILL.md`, insert the following immediately after the `## Workflow` line and before `### Step 1`:

```markdown
### Step 0: Refresh Ecosystem Cache

Run the ecosystem cache refresh script to gather data about available plugins, MCP servers, and skills:

```bash
node ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs \
  --sessions-json /tmp/workflow-analyst-sessions.json \
  --history-json /tmp/workflow-analyst-history.json
```

Note: This step uses the session and history data from Step 1. Run Step 1 first, then run this step. The script writes to `~/.claude/skills/workflow-analyst/ecosystem-cache.json`.

If the script fails, skip ecosystem insights and continue with the rest of the analysis.
```

Wait — this creates a dependency problem. Step 0 needs Step 1 output. Let me restructure.

Actually, re-read the design doc: Step 0 runs *before* Step 1. But it needs sessions data. The design says "reads local files + fetches from GitHub/MCP Registry." The tech stack inference and prompt themes are bonuses from session data — the script works without them.

So the correct approach: run refresh-ecosystem.mjs *after* Step 1 (parse sessions), but before Step 4 (analyze). Insert it as Step 1.5 or change numbering.

**Revised: Insert ecosystem refresh between Step 1 and Step 2**

In `~/.claude/skills/workflow-analyst/SKILL.md`, after the Step 1 section (after the "Read both output files..." paragraph), add:

```markdown
### Step 1b: Refresh Ecosystem Cache

Run the ecosystem cache refresh script. Pass the session and history data files so it can infer tech stack and prompt themes:

```bash
node ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs \
  --sessions-json /tmp/workflow-analyst-sessions.json \
  --history-json /tmp/workflow-analyst-history.json
```

This writes `~/.claude/skills/workflow-analyst/ecosystem-cache.json`. If the script fails, skip ecosystem discovery in Step 4 and continue with the rest of the analysis.
```

**Step 2: Expand Step 4 with Ecosystem Discovery**

In the Step 4 section, after the **Automation Opportunities** subsection, add:

```markdown
**Ecosystem Discovery:**
- Read `~/.claude/skills/workflow-analyst/ecosystem-cache.json`
- For available plugins not installed: check if the plugin's name, description, or tags match the user's tech stack or prompt themes. Only recommend if there's a clear relevance match.
- For installed plugins: check if a newer version is available by comparing install-counts-cache.json data against installed_plugins.json versions
- For MCP servers: report any in `failed` or `needsAuth` status from the cache's `mcpServerHealth`
- For MCP servers in the registry but not installed: recommend only if they match the user's tech stack or prompt themes
- Cross-reference against dismissed ecosystem insights from Step 3 to avoid repeating
- Produce 2-4 ecosystem insights, prioritized by: (1) broken/needs-auth MCP servers, (2) high-install plugins matching usage patterns, (3) plugin updates available
```

**Step 3: Add `ecosystem` to the category list in Step 4**

Find this line in Step 4:
```
- **Category**: feature-discovery | anti-pattern | productivity | automation
```

Change it to:
```
- **Category**: feature-discovery | anti-pattern | productivity | automation | ecosystem
```

**Step 4: Verify the skill file is valid**

Run: `head -5 ~/.claude/skills/workflow-analyst/SKILL.md`
Expected: Shows the frontmatter header

**Step 5: Commit**

```bash
git add ~/.claude/skills/workflow-analyst/SKILL.md
git commit -m "feat: add ecosystem discovery to workflow analyst skill"
```

---

### Task 7: End-to-End Test

**Files:** None (testing only)

**Step 1: Run the full workflow analyst pipeline manually**

First, generate session data:
```bash
node ~/.claude/skills/workflow-analyst/parse-sessions.mjs --days 7 --output /tmp/workflow-analyst-sessions.json
node ~/.claude/skills/workflow-analyst/parse-history.mjs --days 7 > /tmp/workflow-analyst-history.json
```

**Step 2: Run ecosystem refresh with session data**

```bash
node ~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs \
  --sessions-json /tmp/workflow-analyst-sessions.json \
  --history-json /tmp/workflow-analyst-history.json
```

Expected: Outputs JSON with `ok: true`, `plugins` count > 0

**Step 3: Verify cache has populated data**

```bash
cat ~/.claude/skills/workflow-analyst/ecosystem-cache.json | python3 -m json.tool | head -40
```

Expected: `techStack` array has entries, `plugins.available` has entries with `installs` > 1000, `plugins.installed` lists installed plugins

**Step 4: Verify Convex accepts ecosystem category**

Run: `cd packages/convex && npx convex dev --once --typecheck disable 2>&1 | tail -5`
Expected: No errors

**Step 5: Verify web app builds**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds

---

### Task 8: Deploy Convex Changes

**Files:** None (deployment only)

**Step 1: Deploy Convex to production**

Since the validator change adds a new literal to a union, this is backward-compatible. Deploy:

```bash
cd packages/convex && npx convex deploy --cmd 'npx convex deploy' 2>&1 | tail -5
```

Or, if using the project's deploy script:
```bash
pnpm -F @repo/db deploy:prod
```

Expected: Deployment succeeds

**Step 2: Verify the deployment**

Run: `npx convex dashboard` or check that the Convex dashboard shows the updated schema

**Step 3: Commit any lockfile changes if needed**

If `pnpm-lock.yaml` changed:
```bash
git add pnpm-lock.yaml
git commit -m "chore: update lockfile after convex deploy"
```
