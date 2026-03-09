# AI Workflow Analyst Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code skill + parser that weekly analyzes session transcripts, researches latest capabilities, and generates actionable workflow insights saved to AI Brain and markdown reports.

**Architecture:** A Node.js parser script extracts/aggregates data from `~/.claude/` JSONL session files into a compact JSON summary. A Claude Code skill file orchestrates the full workflow: run parser, web-search for latest features, check AI Brain for previous insights, analyze, publish results. A macOS launchctl plist automates weekly execution.

**Tech Stack:** Node.js (parser script), Claude Code skill (SKILL.md), launchctl (scheduling), AI Brain MCP (output)

**Reference:** Design doc at `docs/plans/2026-03-07-workflow-analyst-design.md`

---

### Task 1: Session Parser Script — Test Fixtures

**Files:**
- Create: `~/.claude/skills/workflow-analyst/test/fixtures/simple-session.jsonl`
- Create: `~/.claude/skills/workflow-analyst/test/fixtures/error-session.jsonl`

Create minimal but realistic JSONL fixtures based on the actual session format observed in `~/.claude/projects/`. These fixtures drive the parser tests.

**Step 1: Create the test fixtures directory**

```bash
mkdir -p ~/.claude/skills/workflow-analyst/test/fixtures
```

**Step 2: Create simple-session.jsonl**

A minimal session with: 1 progress entry (session start), 1 user message, 1 assistant response with a tool call (Read), 1 tool result (success), 1 assistant response. Must include realistic fields: `type`, `sessionId`, `cwd`, `gitBranch`, `version`, `timestamp`, `message.role`, `message.content` with tool_use/tool_result blocks.

```jsonl
{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/Users/test/project-a","sessionId":"test-session-001","version":"2.1.71","gitBranch":"main","type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"echo ok"},"timestamp":"2026-03-01T09:00:00.000Z","uuid":"uuid-001"}
{"parentUuid":"uuid-001","isSidechain":false,"userType":"external","cwd":"/Users/test/project-a","sessionId":"test-session-001","version":"2.1.71","gitBranch":"main","type":"user","message":{"role":"user","content":"Read the config file and explain it"},"timestamp":"2026-03-01T09:01:00.000Z","uuid":"uuid-002"}
{"parentUuid":"uuid-002","isSidechain":false,"userType":"external","cwd":"/Users/test/project-a","sessionId":"test-session-001","version":"2.1.71","gitBranch":"main","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me read that file."},{"type":"tool_use","id":"tool-001","name":"Read","input":{"file_path":"/Users/test/project-a/config.json"}}],"model":"claude-sonnet-4-20250514"},"timestamp":"2026-03-01T09:01:05.000Z","uuid":"uuid-003"}
{"parentUuid":"uuid-003","isSidechain":false,"userType":"external","cwd":"/Users/test/project-a","sessionId":"test-session-001","version":"2.1.71","gitBranch":"main","type":"tool_result","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-001","content":"{ \"key\": \"value\" }"}]},"timestamp":"2026-03-01T09:01:06.000Z","uuid":"uuid-004"}
{"parentUuid":"uuid-004","isSidechain":false,"userType":"external","cwd":"/Users/test/project-a","sessionId":"test-session-001","version":"2.1.71","gitBranch":"main","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"The config file contains a single key-value pair."}],"model":"claude-sonnet-4-20250514"},"timestamp":"2026-03-01T09:01:10.000Z","uuid":"uuid-005"}
```

**Step 3: Create error-session.jsonl**

A session with: 1 user message, 1 assistant tool call (Bash) that fails, 1 retry of same tool, 1 permission denial. Covers error extraction paths.

```jsonl
{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"echo ok"},"timestamp":"2026-03-02T14:00:00.000Z","uuid":"uuid-101"}
{"parentUuid":"uuid-101","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"user","message":{"role":"user","content":"Run the tests"},"timestamp":"2026-03-02T14:01:00.000Z","uuid":"uuid-102"}
{"parentUuid":"uuid-102","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool-101","name":"Bash","input":{"command":"npm test"}}],"model":"claude-sonnet-4-20250514"},"timestamp":"2026-03-02T14:01:05.000Z","uuid":"uuid-103"}
{"parentUuid":"uuid-103","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"tool_result","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-101","content":"Error: test suite failed\n  3 tests failed","is_error":true}]},"timestamp":"2026-03-02T14:01:10.000Z","uuid":"uuid-104"}
{"parentUuid":"uuid-104","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool-102","name":"Bash","input":{"command":"npm test"}}],"model":"claude-sonnet-4-20250514"},"timestamp":"2026-03-02T14:01:15.000Z","uuid":"uuid-105"}
{"parentUuid":"uuid-105","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"tool_result","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-102","content":"Error: test suite failed\n  3 tests failed","is_error":true}]},"timestamp":"2026-03-02T14:01:20.000Z","uuid":"uuid-106"}
{"parentUuid":"uuid-106","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool-103","name":"Write","input":{"file_path":"/etc/passwd","content":"hacked"}}],"model":"claude-sonnet-4-20250514"},"timestamp":"2026-03-02T14:01:25.000Z","uuid":"uuid-107"}
{"parentUuid":"uuid-107","isSidechain":false,"userType":"external","cwd":"/Users/test/project-b","sessionId":"test-session-002","version":"2.1.71","gitBranch":"feat/login","type":"tool_result","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-103","content":"User denied tool call","is_error":true}]},"timestamp":"2026-03-02T14:01:30.000Z","uuid":"uuid-108"}
```

**Step 4: Commit fixtures**

```bash
cd ~/.claude/skills/workflow-analyst
git init
git add test/fixtures/
git commit -m "test: add JSONL session fixtures for parser tests"
```

---

### Task 2: Session Parser Script — Tests

**Files:**
- Create: `~/.claude/skills/workflow-analyst/test/parse-sessions.test.mjs`
- Create: `~/.claude/skills/workflow-analyst/package.json`

**Step 1: Create package.json**

```json
{
  "name": "workflow-analyst",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs"
  }
}
```

**Step 2: Write the parser tests**

Uses Node.js built-in test runner (no dependencies). Tests cover:

1. Parse a single session file → returns session summary with correct metadata
2. Extract tool usage counts from a session
3. Detect error/retry patterns
4. Detect permission denials
5. Aggregate multiple sessions into cross-session stats
6. Filter sessions by date range (last 7 days)

```javascript
// test/parse-sessions.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, aggregateSessions, findRecentSessions } from '../parse-sessions.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('parseSession', () => {
  it('extracts session metadata from simple session', () => {
    const lines = readFileSync(join(fixturesDir, 'simple-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-a');

    assert.equal(result.sessionId, 'test-session-001');
    assert.equal(result.project, '/Users/test/project-a');
    assert.equal(result.gitBranch, 'main');
    assert.equal(result.version, '2.1.71');
    assert.ok(result.startTime);
    assert.ok(result.endTime);
    assert.ok(result.durationMinutes >= 0);
  });

  it('extracts tool usage counts', () => {
    const lines = readFileSync(join(fixturesDir, 'simple-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-a');

    assert.equal(result.toolUsage.Read.calls, 1);
    assert.equal(result.toolUsage.Read.successes, 1);
    assert.equal(result.toolUsage.Read.failures, 0);
  });

  it('extracts user message count', () => {
    const lines = readFileSync(join(fixturesDir, 'simple-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-a');

    assert.equal(result.userMessageCount, 1);
  });

  it('detects errors and retries', () => {
    const lines = readFileSync(join(fixturesDir, 'error-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-b');

    assert.equal(result.toolUsage.Bash.calls, 2);
    assert.equal(result.toolUsage.Bash.failures, 2);
    assert.ok(result.retrySequences.length >= 1);
    assert.equal(result.retrySequences[0].tool, 'Bash');
    assert.equal(result.retrySequences[0].count, 2);
  });

  it('detects permission denials', () => {
    const lines = readFileSync(join(fixturesDir, 'error-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-b');

    assert.equal(result.permissionDenials, 1);
    assert.ok(result.deniedTools.includes('Write'));
  });

  it('extracts model used', () => {
    const lines = readFileSync(join(fixturesDir, 'simple-session.jsonl'), 'utf-8');
    const result = parseSession(lines, '/Users/test/project-a');

    assert.equal(result.model, 'claude-sonnet-4-20250514');
  });
});

describe('aggregateSessions', () => {
  it('combines multiple session summaries into aggregate stats', () => {
    const lines1 = readFileSync(join(fixturesDir, 'simple-session.jsonl'), 'utf-8');
    const lines2 = readFileSync(join(fixturesDir, 'error-session.jsonl'), 'utf-8');
    const session1 = parseSession(lines1, '/Users/test/project-a');
    const session2 = parseSession(lines2, '/Users/test/project-b');

    const agg = aggregateSessions([session1, session2]);

    assert.equal(agg.totalSessions, 2);
    assert.equal(agg.projectBreakdown['/Users/test/project-a'], 1);
    assert.equal(agg.projectBreakdown['/Users/test/project-b'], 1);
    assert.equal(agg.toolUsageTotal.Read.calls, 1);
    assert.equal(agg.toolUsageTotal.Bash.calls, 2);
    assert.equal(agg.totalPermissionDenials, 1);
    assert.ok(agg.totalRetrySequences >= 1);
  });
});

describe('findRecentSessions', () => {
  it('returns file paths for sessions modified within the time window', () => {
    // This test uses the fixtures dir as a mock projects dir
    const since = new Date('2020-01-01');
    const files = findRecentSessions(fixturesDir, since);

    // Should find both fixture files (they were just created)
    assert.ok(files.length >= 2);
    assert.ok(files.every(f => f.endsWith('.jsonl')));
  });

  it('returns empty array when no files match the time window', () => {
    const futureDate = new Date('2099-01-01');
    const files = findRecentSessions(fixturesDir, futureDate);

    assert.equal(files.length, 0);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
cd ~/.claude/skills/workflow-analyst
node --test test/parse-sessions.test.mjs
```

Expected: FAIL — `parse-sessions.mjs` does not exist yet.

**Step 4: Commit tests**

```bash
git add package.json test/parse-sessions.test.mjs
git commit -m "test: add parser unit tests (red phase)"
```

---

### Task 3: Session Parser Script — Implementation

**Files:**
- Create: `~/.claude/skills/workflow-analyst/parse-sessions.mjs`

Implement the parser to make all tests from Task 2 pass. No external dependencies — uses only Node.js built-ins.

**Step 1: Implement parse-sessions.mjs**

```javascript
// parse-sessions.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Parse a single session's JSONL content into a structured summary.
 * @param {string} content - Raw JSONL file content
 * @param {string} projectPath - The project path for this session
 * @returns {object} Session summary
 */
export function parseSession(content, projectPath) {
  const lines = content.trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  const summary = {
    sessionId: null,
    project: projectPath,
    gitBranch: null,
    version: null,
    model: null,
    startTime: null,
    endTime: null,
    durationMinutes: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolUsage: {},       // { ToolName: { calls, successes, failures } }
    retrySequences: [],  // [{ tool, count }]
    permissionDenials: 0,
    deniedTools: [],
    skillsInvoked: [],
    userPrompts: [],     // First 100 chars of each user message
  };

  // Track consecutive tool calls for retry detection
  let lastToolCall = null;
  let consecutiveCount = 0;
  let lastToolFailed = false;

  for (const entry of entries) {
    // Extract session metadata from first entry that has it
    if (entry.sessionId && !summary.sessionId) summary.sessionId = entry.sessionId;
    if (entry.gitBranch && !summary.gitBranch) summary.gitBranch = entry.gitBranch;
    if (entry.version && !summary.version) summary.version = entry.version;

    // Track timestamps
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp).toISOString();
      if (!summary.startTime || ts < summary.startTime) summary.startTime = ts;
      if (!summary.endTime || ts > summary.endTime) summary.endTime = ts;
    }

    // User messages
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : null;
      if (content) {
        summary.userMessageCount++;
        summary.userPrompts.push(content.slice(0, 100));

        // Detect skill invocations
        const skillMatch = content.match(/<command-name>\/([\w:-]+)<\/command-name>/);
        if (skillMatch) summary.skillsInvoked.push(skillMatch[1]);
      }

      // Handle tool_result in user messages
      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_result') {
            const isError = block.is_error === true;
            const isDenial = typeof block.content === 'string' &&
              block.content.includes('denied');

            // Find which tool this result belongs to by matching tool_use_id
            // We track this via the lastToolCall mechanism below
            if (isDenial) {
              summary.permissionDenials++;
            }
          }
        }
      }
    }

    // Tool result entries (type === 'tool_result')
    if (entry.type === 'tool_result' && entry.message?.content) {
      const blocks = Array.isArray(entry.message.content)
        ? entry.message.content
        : [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const isError = block.is_error === true;
          const isDenial = typeof block.content === 'string' &&
            block.content.toLowerCase().includes('denied');

          // Find matching tool call
          const toolUseId = block.tool_use_id;
          const matchingTool = findToolNameByUseId(entries, toolUseId);

          if (matchingTool) {
            if (!summary.toolUsage[matchingTool]) {
              summary.toolUsage[matchingTool] = { calls: 0, successes: 0, failures: 0 };
            }
            summary.toolUsage[matchingTool].calls++;

            if (isError) {
              summary.toolUsage[matchingTool].failures++;
            } else {
              summary.toolUsage[matchingTool].successes++;
            }

            if (isDenial) {
              summary.permissionDenials++;
              if (!summary.deniedTools.includes(matchingTool)) {
                summary.deniedTools.push(matchingTool);
              }
            }

            // Retry detection
            if (lastToolCall === matchingTool && lastToolFailed) {
              consecutiveCount++;
            } else {
              if (consecutiveCount >= 2) {
                summary.retrySequences.push({ tool: lastToolCall, count: consecutiveCount });
              }
              consecutiveCount = 1;
            }
            lastToolCall = matchingTool;
            lastToolFailed = isError;
          }
        }
      }
    }

    // Assistant messages — extract model
    if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      summary.assistantMessageCount++;
      if (entry.message.model && !summary.model) {
        summary.model = entry.message.model;
      }
    }
  }

  // Flush last retry sequence
  if (consecutiveCount >= 2) {
    summary.retrySequences.push({ tool: lastToolCall, count: consecutiveCount });
  }

  // Calculate duration
  if (summary.startTime && summary.endTime) {
    const ms = new Date(summary.endTime) - new Date(summary.startTime);
    summary.durationMinutes = Math.round(ms / 60000 * 10) / 10;
  }

  return summary;
}

/**
 * Find the tool name for a given tool_use_id by searching assistant messages.
 */
function findToolNameByUseId(entries, toolUseId) {
  for (const entry of entries) {
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use' && block.id === toolUseId) {
          return block.name;
        }
      }
    }
  }
  return null;
}

/**
 * Aggregate multiple session summaries into cross-session stats.
 * @param {object[]} sessions - Array of parseSession results
 * @returns {object} Aggregated stats
 */
export function aggregateSessions(sessions) {
  const agg = {
    totalSessions: sessions.length,
    totalUserMessages: 0,
    totalPermissionDenials: 0,
    totalRetrySequences: 0,
    projectBreakdown: {},    // { projectPath: sessionCount }
    toolUsageTotal: {},      // { ToolName: { calls, successes, failures } }
    timeOfDayDistribution: new Array(24).fill(0), // hour buckets
    modelUsage: {},          // { model: count }
    topRetries: [],          // [{ tool, totalRetries }]
    sessionsData: sessions,  // Keep individual sessions for detail
  };

  const retryByTool = {};

  for (const s of sessions) {
    agg.totalUserMessages += s.userMessageCount;
    agg.totalPermissionDenials += s.permissionDenials;
    agg.totalRetrySequences += s.retrySequences.length;

    // Project breakdown
    agg.projectBreakdown[s.project] = (agg.projectBreakdown[s.project] || 0) + 1;

    // Tool usage
    for (const [tool, counts] of Object.entries(s.toolUsage)) {
      if (!agg.toolUsageTotal[tool]) {
        agg.toolUsageTotal[tool] = { calls: 0, successes: 0, failures: 0 };
      }
      agg.toolUsageTotal[tool].calls += counts.calls;
      agg.toolUsageTotal[tool].successes += counts.successes;
      agg.toolUsageTotal[tool].failures += counts.failures;
    }

    // Time of day
    if (s.startTime) {
      const hour = new Date(s.startTime).getHours();
      agg.timeOfDayDistribution[hour]++;
    }

    // Model usage
    if (s.model) {
      agg.modelUsage[s.model] = (agg.modelUsage[s.model] || 0) + 1;
    }

    // Retries
    for (const r of s.retrySequences) {
      retryByTool[r.tool] = (retryByTool[r.tool] || 0) + r.count;
    }
  }

  agg.topRetries = Object.entries(retryByTool)
    .map(([tool, totalRetries]) => ({ tool, totalRetries }))
    .sort((a, b) => b.totalRetries - a.totalRetries);

  return agg;
}

/**
 * Find JSONL session files modified since a given date.
 * Walks the directory recursively looking for .jsonl files.
 * @param {string} dir - Root directory to search
 * @param {Date} since - Only include files modified after this date
 * @returns {string[]} Array of absolute file paths
 */
export function findRecentSessions(dir, since) {
  const results = [];

  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = statSync(fullPath);
          if (stat.mtimeMs >= since.getTime()) {
            results.push(fullPath);
          }
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }

  walk(dir);
  return results;
}


// --- CLI entry point ---
// When run directly: node parse-sessions.mjs [--days N] [--output path]

const isMain = process.argv[1] &&
  (process.argv[1].endsWith('parse-sessions.mjs') ||
   process.argv[1].endsWith('parse-sessions'));

if (isMain) {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 7;
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

  const projectsDir = join(process.env.HOME, '.claude', 'projects');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.error(`Scanning for sessions since ${since.toISOString()}...`);
  const files = findRecentSessions(projectsDir, since);
  console.error(`Found ${files.length} session files.`);

  const sessions = [];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      // Derive project path from file location
      // ~/.claude/projects/{project-path}/{session-id}.jsonl
      const relPath = file.replace(join(process.env.HOME, '.claude', 'projects') + '/', '');
      const projectPath = relPath.split('/').slice(0, -1).join('/');
      const summary = parseSession(content, projectPath);
      sessions.push(summary);
    } catch (e) {
      console.error(`Error parsing ${file}: ${e.message}`);
    }
  }

  const aggregate = aggregateSessions(sessions);

  // Remove sessionsData.userPrompts for compact output (or keep for analysis)
  const output = JSON.stringify(aggregate, null, 2);

  if (outputPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputPath, output);
    console.error(`Output written to ${outputPath}`);
  } else {
    console.log(output);
  }
}
```

**Step 2: Run the tests**

```bash
cd ~/.claude/skills/workflow-analyst
node --test test/parse-sessions.test.mjs
```

Expected: All tests PASS.

**Step 3: Run against real data to smoke test**

```bash
cd ~/.claude/skills/workflow-analyst
node parse-sessions.mjs --days 7 2>/dev/null | head -50
```

Expected: JSON output with real session stats.

**Step 4: Commit**

```bash
git add parse-sessions.mjs
git commit -m "feat: implement JSONL session parser with CLI entry point"
```

---

### Task 4: History Parser

**Files:**
- Create: `~/.claude/skills/workflow-analyst/parse-history.mjs`
- Create: `~/.claude/skills/workflow-analyst/test/parse-history.test.mjs`
- Create: `~/.claude/skills/workflow-analyst/test/fixtures/history.jsonl`

Parse `~/.claude/history.jsonl` to find frequently typed prompts and project activity from input history.

**Step 1: Create test fixture**

```jsonl
{"display":"Read the config file","pastedContents":{},"timestamp":1741000000000,"project":"/Users/test/project-a","sessionId":"s1"}
{"display":"Run the tests","pastedContents":{},"timestamp":1741000100000,"project":"/Users/test/project-a","sessionId":"s1"}
{"display":"Run the tests","pastedContents":{},"timestamp":1741000200000,"project":"/Users/test/project-b","sessionId":"s2"}
{"display":"Run the tests","pastedContents":{},"timestamp":1741000300000,"project":"/Users/test/project-a","sessionId":"s3"}
{"display":"/commit","pastedContents":{},"timestamp":1741000400000,"project":"/Users/test/project-a","sessionId":"s3"}
{"display":"/commit","pastedContents":{},"timestamp":1741000500000,"project":"/Users/test/project-b","sessionId":"s4"}
```

**Step 2: Write tests**

```javascript
// test/parse-history.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory } from '../parse-history.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures', 'history.jsonl'), 'utf-8');

describe('parseHistory', () => {
  it('finds frequently typed prompts', () => {
    const result = parseHistory(fixture);
    const topPrompt = result.frequentPrompts[0];

    assert.equal(topPrompt.prompt, 'Run the tests');
    assert.equal(topPrompt.count, 3);
  });

  it('identifies slash commands separately', () => {
    const result = parseHistory(fixture);
    const commitCmd = result.frequentPrompts.find(p => p.prompt === '/commit');

    assert.ok(commitCmd);
    assert.equal(commitCmd.count, 2);
  });

  it('calculates project activity from history', () => {
    const result = parseHistory(fixture);

    assert.equal(result.projectActivity['/Users/test/project-a'], 4);
    assert.equal(result.projectActivity['/Users/test/project-b'], 2);
  });
});
```

**Step 3: Run tests — should fail**

```bash
node --test test/parse-history.test.mjs
```

**Step 4: Implement parse-history.mjs**

```javascript
// parse-history.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Parse history.jsonl content to find frequent prompts and project activity.
 * @param {string} content - Raw history.jsonl content
 * @param {Date} [since] - Only include entries after this date
 * @returns {object} { frequentPrompts, projectActivity }
 */
export function parseHistory(content, since) {
  const lines = content.trim().split('\n').filter(Boolean);
  const promptCounts = {};
  const projectCounts = {};

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (since && entry.timestamp < since.getTime()) continue;

    const prompt = entry.display?.trim();
    if (!prompt) continue;

    promptCounts[prompt] = (promptCounts[prompt] || 0) + 1;

    if (entry.project) {
      projectCounts[entry.project] = (projectCounts[entry.project] || 0) + 1;
    }
  }

  const frequentPrompts = Object.entries(promptCounts)
    .map(([prompt, count]) => ({ prompt, count }))
    .sort((a, b) => b.count - a.count);

  return {
    frequentPrompts,
    projectActivity: projectCounts,
  };
}

// CLI entry point
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('parse-history.mjs') ||
   process.argv[1].endsWith('parse-history'));

if (isMain) {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const historyPath = join(process.env.HOME, '.claude', 'history.jsonl');
  const content = readFileSync(historyPath, 'utf-8');
  const result = parseHistory(content, since);

  console.log(JSON.stringify(result, null, 2));
}
```

**Step 5: Run tests — should pass**

```bash
node --test test/parse-history.test.mjs
```

**Step 6: Commit**

```bash
git add parse-history.mjs test/parse-history.test.mjs test/fixtures/history.jsonl
git commit -m "feat: add history.jsonl parser for frequent prompts"
```

---

### Task 5: Skill File — The Analyst Prompt

**Files:**
- Create: `~/.claude/skills/workflow-analyst/SKILL.md`

This is the core skill file that Claude Code executes. It orchestrates the full workflow: run parser, research capabilities, check previous insights, analyze, publish.

**Step 1: Create the skill file**

```markdown
---
name: workflow-analyst
description: Analyze your Claude Code session history to surface workflow insights, underused features, anti-patterns, and automation opportunities. Run weekly or on-demand.
argument-hint: [--days N]
---

# AI Workflow Analyst

Analyze recent Claude Code sessions to generate actionable workflow insights.

## Arguments

- `$ARGUMENTS` — Optional:
  - `--days N` — How many days of history to analyze (default: 7)

## Workflow

### Step 1: Parse Session Data

Run the session parser to extract structured data from recent sessions:

```bash
node ~/.claude/skills/workflow-analyst/parse-sessions.mjs --days ${DAYS:-7} --output /tmp/workflow-analyst-sessions.json
```

Read the output file to get the aggregated session data.

Also run the history parser:

```bash
node ~/.claude/skills/workflow-analyst/parse-history.mjs --days ${DAYS:-7} > /tmp/workflow-analyst-history.json
```

Read both output files. If no sessions were found (totalSessions === 0), write a short "no activity" report to `~/.claude/workflow-reports/` and stop.

### Step 2: Research Latest Capabilities

Use web search to find the latest Claude Code features and tips:

1. Search for: "Claude Code new features changelog 2026"
2. Search for: "Claude Code tips best practices"
3. Search for: "Anthropic Claude Code release notes"

Summarize findings as a list of capabilities and tips. Note any features released in the last 30 days.

### Step 3: Check Previous Insights

Search the AI Brain for recent workflow insights to avoid repeating advice:

Use the `search_thoughts` MCP tool with query: "workflow insight claude code"

Note which insights have already been given so you don't repeat them.

### Step 4: Analyze

With all data gathered, produce insights in four categories:

**Feature Discovery:**
- Compare the tool/skill list from session system prompts against actual tool usage
- Cross-reference with newly announced features from Step 2
- Identify tools that exist but were never or rarely used
- Check if Bash was used for things that dedicated tools handle (grep → Grep, cat → Read, find → Glob, sed → Edit)

**Workflow Anti-Patterns:**
- Tools with high failure rates (failures / calls > 30%)
- Permission denials — which tools and how often
- Retry sequences — same tool called multiple times in a row after failure
- Sessions that ended abruptly or had long error chains

**Productivity Patterns:**
- Sessions per project — which projects get the most attention
- Time-of-day distribution — when the user is most active
- Average session duration
- Model usage breakdown
- Total user messages and tool calls

**Automation Opportunities:**
- Frequently typed prompts from history (candidates for skills or aliases)
- Repeated multi-step sequences across sessions
- Slash commands used most often
- Patterns that could become hooks or scheduled tasks

For each insight, produce:
- **Category**: feature-discovery | anti-pattern | productivity | automation
- **Observation**: What the data shows
- **Recommendation**: Specific, actionable advice
- **Evidence**: Numbers from the parsed data

### Step 5: Publish to AI Brain

For each insight, save to AI Brain using the `capture_thought` MCP tool:

```
[Workflow Insight — {Category}] (Week of {date})

Observation: {observation}

Recommendation: {recommendation}

Evidence: {evidence}
```

If AI Brain MCP is not available, skip this step and note it in the report.

### Step 6: Write Weekly Report

Create directory if needed:

```bash
mkdir -p ~/.claude/workflow-reports
```

Write the report to `~/.claude/workflow-reports/YYYY-WNN.md` (e.g., `2026-W10.md`).

Report structure:

```markdown
# Workflow Analyst Report — Week {N}, {Year}

## Summary
- **Sessions analyzed:** {count}
- **Projects active:** {list}
- **Total prompts:** {count}
- **Time range:** {start} to {end}

## Quick Wins
{Top 2-3 easiest improvements with highest impact}

## Feature Discovery
{Insights about underused or unknown features}

## Workflow Anti-Patterns
{Insights about friction and inefficiency}

## Productivity Patterns
{Stats and trends about how you work}

## Automation Opportunities
{Repetitive patterns that could be automated}

## Capability Updates
{New features announced this period}

---
*Generated by AI Workflow Analyst on {date}*
```

### Step 7: Summary

After publishing, output a brief summary:
- How many insights were generated
- How many saved to AI Brain
- Where the report was written
- Top 1-2 "quick win" recommendations
```

**Step 2: Commit**

```bash
cd ~/.claude/skills/workflow-analyst
git add SKILL.md
git commit -m "feat: add workflow analyst skill file"
```

---

### Task 6: Manual Test Run

Run the skill manually to verify the full pipeline works end-to-end.

**Step 1: Invoke the skill**

From any Claude Code session, run:

```
/workflow-analyst
```

**Step 2: Verify outputs**

1. Check that `/tmp/workflow-analyst-sessions.json` was created and contains valid aggregated data
2. Check that `/tmp/workflow-analyst-history.json` was created with frequent prompts
3. Check that `~/.claude/workflow-reports/` contains a new report file
4. Check AI Brain for new workflow insight thoughts (use `search_thoughts` with query "workflow insight")
5. Read the generated report and verify it contains all four insight categories

**Step 3: Fix any issues**

If the parser produces incorrect data, fix `parse-sessions.mjs` or `parse-history.mjs` and re-run tests.
If the skill prompt produces low-quality insights, adjust `SKILL.md` analysis instructions.
If AI Brain save fails, verify MCP connection is working.

**Step 4: Commit any fixes**

```bash
cd ~/.claude/skills/workflow-analyst
git add -A
git commit -m "fix: adjustments from manual test run"
```

---

### Task 7: Scheduling with launchctl

**Files:**
- Create: `~/Library/LaunchAgents/com.wagglelabs.workflow-analyst.plist`

Set up a macOS launchd job that invokes Claude Code with the workflow-analyst skill weekly.

**Step 1: Find the claude CLI path**

```bash
which claude
```

**Step 2: Create the launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wagglelabs.workflow-analyst</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/claude</string>
        <string>-p</string>
        <string>/workflow-analyst</string>
        <string>--allowedTools</string>
        <string>Bash,Read,Write,Glob,Grep,WebSearch,WebFetch,mcp__claude_ai_AI_Brain__capture_thought,mcp__claude_ai_AI_Brain__search_thoughts</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>17</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/peterbrown</string>
    <key>StandardOutPath</key>
    <string>/Users/peterbrown/.claude/workflow-reports/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/peterbrown/.claude/workflow-reports/launchd-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/peterbrown</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
```

Note: Replace `/path/to/claude` with the actual path from `which claude`. The `--allowedTools` flag auto-approves the tools the analyst needs without interactive prompts. The schedule runs Monday at 8:17am.

**Step 3: Verify the plist is valid**

```bash
plutil -lint ~/Library/LaunchAgents/com.wagglelabs.workflow-analyst.plist
```

Expected: `OK`

**Step 4: Load the launch agent**

```bash
launchctl load ~/Library/LaunchAgents/com.wagglelabs.workflow-analyst.plist
```

**Step 5: Verify it's loaded**

```bash
launchctl list | grep workflow-analyst
```

Expected: Shows the job with PID `-` (not yet fired) and status `0`.

**Step 6: Commit**

```bash
cd ~/.claude/skills/workflow-analyst
git add -A
git commit -m "feat: add launchctl plist for weekly scheduling"
```

---

### Task 8: Documentation

**Files:**
- Create: `~/.claude/skills/workflow-analyst/README.md`

**Step 1: Write README**

```markdown
# AI Workflow Analyst

Analyzes your Claude Code session history to surface actionable insights.

## What it does

Parses `~/.claude/` session JSONL files and generates insights in four categories:
- **Feature Discovery** — tools and capabilities you're not using
- **Workflow Anti-Patterns** — friction points and inefficiencies
- **Productivity Patterns** — how you spend time across projects
- **Automation Opportunities** — repetitive tasks you could automate

## Usage

### On-demand
```
/workflow-analyst
/workflow-analyst --days 14
```

### Automated
Runs weekly via launchctl (Monday 8:17am). See `com.wagglelabs.workflow-analyst.plist`.

## Output

- **AI Brain**: Insights saved as searchable thoughts via MCP
- **Reports**: `~/.claude/workflow-reports/YYYY-WNN.md`

## Components

- `SKILL.md` — Claude Code skill (orchestration prompt)
- `parse-sessions.mjs` — JSONL session parser (Node.js)
- `parse-history.mjs` — Input history parser (Node.js)
- `test/` — Tests and fixtures

## Development

```bash
cd ~/.claude/skills/workflow-analyst
node --test  # Run all tests
node parse-sessions.mjs --days 7  # Test parser against real data
```
```

**Step 2: Commit**

```bash
cd ~/.claude/skills/workflow-analyst
git add README.md
git commit -m "docs: add README for workflow analyst"
```

---

Plan complete and saved to `docs/plans/2026-03-07-workflow-analyst-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?
