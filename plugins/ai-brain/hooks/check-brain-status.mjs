#!/usr/bin/env node

// Check if the user's AI Brain has any thoughts.
// If empty, suggest running /brain-init.
// Exits silently if brain has content or is unreachable.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_BRAIN_URL = "https://ai-brain-pi.vercel.app/api/mcp";

async function getBrainUrl() {
  try {
    const hookDir = dirname(fileURLToPath(import.meta.url));
    const configPath = join(hookDir, "..", ".mcp.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    return config?.mcpServers?.["ai-brain"]?.url || DEFAULT_BRAIN_URL;
  } catch {
    return DEFAULT_BRAIN_URL;
  }
}

function getAuthHeader() {
  const explicitAuth =
    process.env.AI_BRAIN_AUTHORIZATION ?? process.env.MCP_AUTHORIZATION;
  if (explicitAuth) return explicitAuth;

  const token =
    process.env.AI_BRAIN_TOKEN ??
    process.env.AI_BRAIN_API_KEY ??
    process.env.MCP_AUTH_TOKEN;
  return token ? `Bearer ${token}` : undefined;
}

async function checkBrainStatus() {
  try {
    const brainUrl = await getBrainUrl();
    const headers = { "Content-Type": "application/json" };
    const authorization = getAuthHeader();
    if (authorization) headers.Authorization = authorization;

    const initRes = await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "ai-brain-hook", version: "3.0.0" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!initRes.ok) process.exit(0);

    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) headers["mcp-session-id"] = sessionId;

    await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    const statsRes = await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_stats", arguments: {} },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!statsRes.ok) process.exit(0);

    const data = await statsRes.json();
    const content = data?.result?.content?.[0]?.text;
    if (content) {
      const stats = JSON.parse(content);
      if (stats.totalThoughts === 0) {
        console.log(
          "Your AI Brain is empty. Run `/brain-init` to set up your knowledge base from connected tools and AI memory. Once populated, try `/brain-thread <topic>` or `/brain-context <date>` to explore."
        );
      }
    }
  } catch {
    // Any error — exit silently
  }
}

checkBrainStatus();
