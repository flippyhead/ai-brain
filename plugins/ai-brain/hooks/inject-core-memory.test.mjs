import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  CORE_MEMORY_LIMIT,
  buildSessionBlock,
  fetchCoreMemory,
  formatCoreMemory,
  isDisabled,
} from "./inject-core-memory.mjs";

const script = new URL("./inject-core-memory.mjs", import.meta.url).pathname;
const brainUrl = "https://brain.example.test/api/mcp";

const payload = {
  coreFacts: [
    {
      id: "fact-employer",
      citation: "fact:fact-employer",
      statement: "Jordan works at Atlas Memory.",
      isCore: true,
    },
    {
      id: "fact-city",
      statement: "  Jordan lives in\n Los Angeles.  ",
    },
  ],
  coreMemories: [
    {
      id: "thought-tone",
      content:
        "Jordan prefers concise, direct answers and dislikes preamble in replies.",
      metadata: { summary: "Prefers concise, direct answers" },
    },
    {
      id: "thought-no-summary",
      content: "Jordan avoids meetings before 9 AM.",
      metadata: { summary: "" },
    },
  ],
};

/** A fetch stub that answers the MCP handshake and one tools/call. */
function brainFetch({
  initStatus = 200,
  callStatus = 200,
  result = payload,
  callBody,
  sessionId = "session-1",
} = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      const headers = new Headers();
      if (body.method === "initialize") {
        if (sessionId) headers.set("mcp-session-id", sessionId);
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
          { status: initStatus, headers },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      const responseBody =
        callBody ??
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        });
      return new Response(responseBody, { status: callStatus, headers });
    },
  };
}

describe("formatCoreMemory", () => {
  test("renders facts as one-line statements and memories as summaries with citations", () => {
    const block = formatCoreMemory(payload);
    assert.equal(
      block,
      [
        "## Core memory (AI Brain)",
        "Facts:",
        "- Jordan works at Atlas Memory. (fact:fact-employer)",
        "- Jordan lives in Los Angeles. (fact:fact-city)",
        "Memories:",
        "- Prefers concise, direct answers (thought:thought-tone)",
        "- Jordan avoids meetings before 9 AM. (thought:thought-no-summary)",
        "Fuller, message-specific recall is available via the recall_context tool.",
      ].join("\n"),
    );
  });

  test("omits an empty section rather than printing a bare heading", () => {
    const block = formatCoreMemory({
      coreFacts: [],
      coreMemories: payload.coreMemories.slice(0, 1),
    });
    assert.doesNotMatch(block, /Facts:/);
    assert.match(block, /^## Core memory \(AI Brain\)\nMemories:\n- Prefers/);
  });

  test("prints nothing when the brain has no core context", () => {
    assert.equal(formatCoreMemory({ coreFacts: [], coreMemories: [] }), "");
    assert.equal(formatCoreMemory({}), "");
    assert.equal(formatCoreMemory(null), "");
    assert.equal(
      formatCoreMemory({ coreFacts: [{ statement: "   " }], coreMemories: [] }),
      "",
    );
  });

  test("keeps every entry on one bounded line", () => {
    const block = formatCoreMemory({
      coreFacts: [],
      coreMemories: [
        { id: "long", content: "x".repeat(1000), metadata: { summary: "" } },
      ],
    });
    const line = block.split("\n")[2];
    assert.ok(line.startsWith("- "));
    assert.ok(line.endsWith("… (thought:long)"));
    assert.ok(Array.from(line).length < 320);
    assert.equal(block.split("\n").length, 4);
  });
});

describe("fetchCoreMemory", () => {
  test("completes the MCP handshake and calls list_core_memories at the core limit", async () => {
    const stub = brainFetch();
    const result = await fetchCoreMemory({
      fetch: stub.fetch,
      brainUrl,
      authorization: "Bearer test-token",
    });
    assert.deepEqual(result, payload);
    assert.deepEqual(
      stub.calls.map((call) => call.body.method),
      ["initialize", "notifications/initialized", "tools/call"],
    );
    assert.deepEqual(stub.calls[2].body.params, {
      name: "list_core_memories",
      arguments: { limit: CORE_MEMORY_LIMIT },
    });
    assert.equal(stub.calls[2].headers.Authorization, "Bearer test-token");
    assert.equal(stub.calls[2].headers["mcp-session-id"], "session-1");
    for (const call of stub.calls) assert.equal(call.url, brainUrl);
  });

  test("returns null when the brain is unreachable", async () => {
    const result = await fetchCoreMemory({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      brainUrl,
    });
    assert.equal(result, null);
  });

  test("returns null when the brain rejects the credentials", async () => {
    const stub = brainFetch({ initStatus: 401 });
    assert.equal(await fetchCoreMemory({ fetch: stub.fetch, brainUrl }), null);
    assert.equal(stub.calls.length, 1, "stops after the failed initialize");
  });

  test("returns null when the tool call fails or errors", async () => {
    const failing = brainFetch({ callStatus: 500 });
    assert.equal(
      await fetchCoreMemory({ fetch: failing.fetch, brainUrl }),
      null,
    );

    const rpcError = brainFetch({
      callBody: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32602, message: "Unknown tool" },
      }),
    });
    assert.equal(
      await fetchCoreMemory({ fetch: rpcError.fetch, brainUrl }),
      null,
    );

    const toolError = brainFetch({
      callBody: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { isError: true, content: [{ type: "text", text: "nope" }] },
      }),
    });
    assert.equal(
      await fetchCoreMemory({ fetch: toolError.fetch, brainUrl }),
      null,
    );
  });

  test("returns null on a malformed response body", async () => {
    const stub = brainFetch({ callBody: "<html>not json</html>" });
    assert.equal(await fetchCoreMemory({ fetch: stub.fetch, brainUrl }), null);
  });

  test("gives up when the brain is slower than the request budget", async () => {
    // A real socket keeps the event loop alive while the timeout signal's own
    // timer is unref'd; the stub has to hold the loop open the same way.
    const slowFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 5000);
        init.signal.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(init.signal.reason);
        });
      });
    const started = Date.now();
    const result = await fetchCoreMemory({
      fetch: slowFetch,
      brainUrl,
      timeoutMs: 50,
    });
    assert.equal(result, null);
    assert.ok(Date.now() - started < 2000, "aborted within the budget");
  });
});

describe("buildSessionBlock", () => {
  test("prints the block using the token from the environment", async () => {
    const stub = brainFetch();
    const block = await buildSessionBlock({
      fetch: stub.fetch,
      env: { AI_BRAIN_TOKEN: "env-token" },
      brainUrl,
    });
    assert.match(block, /^## Core memory \(AI Brain\)/);
    assert.equal(stub.calls[0].headers.Authorization, "Bearer env-token");
  });

  test("prefers an explicit authorization header over a bare token", async () => {
    const stub = brainFetch();
    await buildSessionBlock({
      fetch: stub.fetch,
      env: { AI_BRAIN_AUTHORIZATION: "Custom abc", AI_BRAIN_TOKEN: "ignored" },
      brainUrl,
    });
    assert.equal(stub.calls[0].headers.Authorization, "Custom abc");
  });

  test("prints nothing without contacting the brain when disabled", async () => {
    const stub = brainFetch();
    const block = await buildSessionBlock({
      fetch: stub.fetch,
      env: { AI_BRAIN_SESSION_RECALL: "0" },
      brainUrl,
    });
    assert.equal(block, "");
    assert.equal(stub.calls.length, 0);
    assert.equal(isDisabled({ AI_BRAIN_SESSION_RECALL: "false" }), true);
    assert.equal(isDisabled({ AI_BRAIN_SESSION_RECALL: "OFF" }), true);
    assert.equal(isDisabled({ AI_BRAIN_SESSION_RECALL: "1" }), false);
    assert.equal(isDisabled({}), false);
  });

  test("prints nothing when the brain is unreachable", async () => {
    const block = await buildSessionBlock({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      env: {},
      brainUrl,
    });
    assert.equal(block, "");
  });
});

describe("hook process", () => {
  test("exits 0 with empty output when the network is unavailable", () => {
    const preload =
      "data:text/javascript," +
      encodeURIComponent(
        'globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));',
      );
    const result = spawnSync(process.execPath, ["--import", preload, script], {
      encoding: "utf8",
      env: { ...process.env, AI_BRAIN_SESSION_RECALL: "" },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  test("exits 0 with empty output when disabled", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, AI_BRAIN_SESSION_RECALL: "0" },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });

  test("prints the block when the brain answers", () => {
    const preload =
      "data:text/javascript," +
      encodeURIComponent(
        `const payload = ${JSON.stringify(payload)};
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  if (body.method === "initialize") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 });
  }
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { status: 200 });
};`,
      );
    const result = spawnSync(process.execPath, ["--import", preload, script], {
      encoding: "utf8",
      env: { ...process.env, AI_BRAIN_SESSION_RECALL: "" },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${formatCoreMemory(payload)}\n`);
    assert.equal(result.stderr, "");
  });
});
