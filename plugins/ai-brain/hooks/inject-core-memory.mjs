#!/usr/bin/env node

// Inject the account's core memory into a new Claude Code session.
//
// Claude Code adds a SessionStart hook's stdout to the session context, which
// is the one place a memory server can put standing context in front of the
// model without waiting for the client to call recall_context. This prints a
// compact "Core memory" block built from the brain's explicitly marked core
// facts and core memories, then points at recall_context for anything deeper.
//
// Fails soft on purpose: an unreachable, slow, or unauthenticated brain prints
// nothing and exits 0 so the session always starts. Nothing is written to disk
// and nothing is logged beyond the injected block.
//
// Set AI_BRAIN_SESSION_RECALL=0 to turn the injection off.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_BRAIN_URL = "https://ai-brain-pi.vercel.app/api/mcp";

/** Mirrors DEFAULT_CORE_MEMORY_LIMIT on the server; the server caps at 25. */
export const CORE_MEMORY_LIMIT = 10;

/** Per-request budget. A slow brain must not delay the session. */
export const REQUEST_TIMEOUT_MS = 4000;

/** Longest single fact or memory line before it is cut. */
const MAX_LINE_CHARS = 280;

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

function getAuthHeader(env = process.env) {
  const explicitAuth = env.AI_BRAIN_AUTHORIZATION ?? env.MCP_AUTHORIZATION;
  if (explicitAuth) return explicitAuth;

  const token =
    env.AI_BRAIN_TOKEN ?? env.AI_BRAIN_API_KEY ?? env.MCP_AUTH_TOKEN;
  return token ? `Bearer ${token}` : undefined;
}

export function isDisabled(env = process.env) {
  const value = env.AI_BRAIN_SESSION_RECALL;
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return ["0", "false", "off", "no"].includes(normalized);
}

function oneLine(text) {
  const collapsed = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(collapsed);
  return chars.length > MAX_LINE_CHARS
    ? `${chars.slice(0, MAX_LINE_CHARS).join("").trimEnd()}…`
    : collapsed;
}

/**
 * Render the list_core_memories payload as the block that lands in context.
 * Returns "" when there is nothing worth injecting.
 */
export function formatCoreMemory(payload) {
  const facts = Array.isArray(payload?.coreFacts) ? payload.coreFacts : [];
  const memories = Array.isArray(payload?.coreMemories)
    ? payload.coreMemories
    : [];

  const factLines = facts
    .map((fact) => {
      const statement = oneLine(fact?.statement);
      if (!statement) return null;
      return fact?.id ? `- ${statement} (fact:${fact.id})` : `- ${statement}`;
    })
    .filter(Boolean);

  const memoryLines = memories
    .map((memory) => {
      const summary = oneLine(memory?.metadata?.summary || memory?.content);
      if (!summary) return null;
      return memory?.id
        ? `- ${summary} (thought:${memory.id})`
        : `- ${summary}`;
    })
    .filter(Boolean);

  if (factLines.length === 0 && memoryLines.length === 0) return "";

  const lines = ["## Core memory (AI Brain)"];
  if (factLines.length > 0) lines.push("Facts:", ...factLines);
  if (memoryLines.length > 0) lines.push("Memories:", ...memoryLines);
  lines.push(
    "Fuller, message-specific recall is available via the recall_context tool.",
  );
  return lines.join("\n");
}

/**
 * Speak just enough MCP over HTTP to call list_core_memories. Resolves to the
 * parsed payload, or null on any failure — callers never need to catch.
 */
export async function fetchCoreMemory({
  fetch: fetchImpl = globalThis.fetch,
  brainUrl,
  authorization,
  timeoutMs = REQUEST_TIMEOUT_MS,
  limit = CORE_MEMORY_LIMIT,
} = {}) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (authorization) headers.Authorization = authorization;

    const post = (body) =>
      fetchImpl(brainUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

    const initRes = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "ai-brain-hook", version: "3.3.0" },
      },
    });
    if (!initRes.ok) return null;

    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) headers["mcp-session-id"] = sessionId;

    await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }).catch(() => null);

    const coreRes = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_core_memories", arguments: { limit } },
    });
    if (!coreRes.ok) return null;

    const data = await coreRes.json();
    if (data?.error || data?.result?.isError) return null;
    const text = data?.result?.content?.[0]?.text;
    if (typeof text !== "string") return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Build the block for the current environment. "" means print nothing. */
export async function buildSessionBlock({
  fetch: fetchImpl = globalThis.fetch,
  env = process.env,
  brainUrl,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (isDisabled(env)) return "";
  const payload = await fetchCoreMemory({
    fetch: fetchImpl,
    brainUrl: brainUrl ?? (await getBrainUrl()),
    authorization: getAuthHeader(env),
    timeoutMs,
  });
  return payload ? formatCoreMemory(payload) : "";
}

async function main() {
  try {
    const block = await buildSessionBlock();
    if (block) console.log(block);
  } catch {
    // Any error — exit silently so the session always starts
  }
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("inject-core-memory.mjs");
if (invokedDirectly) main();
