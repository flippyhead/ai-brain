import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const convexMocks = vi.hoisted(() => ({
  action: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = convexMocks.action;
    mutation = convexMocks.mutation;
    query = convexMocks.query;
    setAuth = convexMocks.setAuth;
  },
}));

import {
  createMcpServer,
  parseValidityTimestamp,
  parseValidityWindow,
} from "./server";
import { MCP_MEMORY_TOOL_NAMES, MCP_TOOL_ANNOTATIONS } from "./tool-policy";
import { MCP_TOOL_NAME_LIST } from "./tools";

describe("MCP memory quality contract", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    delete process.env.MCP_TOOL_PROFILE;
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.MCP_TOOL_PROFILE;
  });

  test("tells capable clients to recall verbatim and capture only grounded facts", async () => {
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const instructions = client.getInstructions();
      expect(instructions).toContain("complete current message verbatim");
      expect(instructions).toContain(
        "Never turn assistant suggestions, guesses, deductions, unconfirmed implications, or incidental connector mentions into user memory",
      );
      expect(instructions).toContain("Never store a derived age");
      expect(instructions).toContain("present a small atomic preview");
      expect(instructions).toContain("version strings");
      expect(instructions).toContain("Mark isCore true only");
      expect(instructions).toContain("client-mediated");

      // The default profile is "full": narrowing the surface removes tools
      // that connected clients and the bundled skills already call, so it has
      // to be opted into rather than inherited on upgrade.
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...MCP_TOOL_NAME_LIST].sort(),
      );
      for (const tool of tools) {
        expect(tool.annotations).toEqual(
          MCP_TOOL_ANNOTATIONS[tool.name as keyof typeof MCP_TOOL_ANNOTATIONS],
        );
      }
      const recall = tools.find((tool) => tool.name === "recall_context");
      const capture = tools.find((tool) => tool.name === "capture_thought");
      const rememberFact = tools.find((tool) => tool.name === "remember_fact");
      const searchFacts = tools.find((tool) => tool.name === "search_facts");

      expect(recall).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      expect(recall?.description).toContain(
        "complete current message verbatim",
      );
      expect(recall?.description).toContain("at most one core fact");
      expect(recall?.inputSchema.properties).toHaveProperty("query");
      expect(capture?.description).toContain("one atomic durable narrative");
      expect(capture?.description).toContain("biographies");
      expect(capture?.inputSchema.properties).toHaveProperty("validFrom");
      expect(capture?.inputSchema.properties).toHaveProperty("validTo");
      expect(capture?.inputSchema.properties).toHaveProperty("isCore");
      expect(capture?.inputSchema.properties).toHaveProperty("sourceType");
      expect(capture?.inputSchema.properties).toHaveProperty(
        "content.maxLength",
        2_000,
      );
      expect(searchFacts?.annotations?.readOnlyHint).toBe(true);
      expect(searchFacts?.description).toContain("by meaning");
      expect(rememberFact?.description).toContain("Never store a derived age");
      expect(rememberFact?.inputSchema.properties).toHaveProperty("subject");
      expect(rememberFact?.inputSchema.properties).toHaveProperty("predicate");
      expect(rememberFact?.inputSchema.properties).toHaveProperty("value");
      expect(capture?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });

      // Retraction and forgetting must be described in complementary terms
      // everywhere the model reads: retract = it was wrong, forget = it must
      // not remain in storage. The rationale phrase forgetting owns must not
      // appear on the retract side, or the two read as the same operation.
      const forgetRationale = "must not remain in storage";
      expect(instructions).toContain(
        `Retract when it was wrong; forget when it ${forgetRationale}`,
      );
      expect(instructions).not.toContain("never have been stored");
      const retract = tools.find((tool) => tool.name === "retract_thought");
      expect(retract?.description).toContain("was never true");
      expect(retract?.description).toContain("forget_thought");
      expect(JSON.stringify(retract)).not.toContain("never have been stored");
      expect(retract?.description).not.toContain(forgetRationale);
      // Forgetting is a hard delete, so every forget tool must be flagged
      // destructive, require a reason, and say how it differs from retraction.
      for (const name of ["forget_thought", "forget_fact", "forget_entity"]) {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool?.annotations?.destructiveHint).toBe(true);
        expect(tool?.description).toContain(forgetRationale);
        expect(tool?.description).toContain("Retract when");
        expect(tool?.description).toContain("no undo");
        expect(tool?.inputSchema.required).toContain("reason");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("narrows to the memory surface only when explicitly opted in", async () => {
    process.env.MCP_TOOL_PROFILE = "memory";
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-profile-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...MCP_MEMORY_TOOL_NAMES].sort(),
      );
      for (const tool of tools) {
        expect(tool.annotations).toEqual(
          MCP_TOOL_ANNOTATIONS[tool.name as keyof typeof MCP_TOOL_ANNOTATIONS],
        );
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("gives core one slot, facts one, and the rest to ranked memories", async () => {
    // Pinned so the window below stays fresh: a clean window carries no gaps
    // block, and this test asserts that.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 8, 2, 12) });
    const query = "What changed in Atlas Memory v2.7.1 for ticket ATLAS-184?";
    const factRow = (id: string, predicate: string, value: string) => ({
      id,
      statement: `Jordan — ${predicate}: ${value}.`,
      subject: {
        id: "entity-jordan",
        key: "person:jordan",
        kind: "person",
        name: "Jordan",
        aliases: [],
      },
      predicate,
      value: { type: "text", value },
      sourceType: "user_stated" as const,
      confidence: 1,
      isCore: predicate === "home_city",
      status: "current" as const,
      createdAt: Date.UTC(2026, 7, 1),
    });
    // The account holds two core facts; only one fits the default window.
    const coreFacts = [
      factRow("fact-home", "home_city", "Fernwood"),
      factRow("fact-timezone", "timezone", "UTC-8"),
    ];
    // Keyword-only fact search matched on "Atlas Memory" without answering.
    const keywordFacts = [
      factRow("fact-role", "role", "Atlas Memory maintainer"),
      factRow("fact-editor", "editor", "Atlas Memory Studio"),
    ];
    convexMocks.query.mockResolvedValueOnce(coreFacts);
    // Fact search embeds the query, so it is an action like thought search.
    convexMocks.action
      .mockResolvedValueOnce(keywordFacts)
      .mockResolvedValueOnce([
        // A core memory that matched the question arrives through the ranking
        // like any other; nothing reserves it a slot.
        {
          _id: "core-preference",
          summary: "Communication preference",
          snippet: "Jordan prefers concise, direct answers.",
          type: "person_note",
          topics: ["communication"],
          score: 0.03,
          createdAt: Date.UTC(2026, 7, 1),
          memoryStatus: "current",
          isCore: true,
        },
        {
          _id: "atlas-version",
          summary: "Atlas Memory release",
          snippet: "Atlas Memory v2.7.1 addresses ATLAS-184.",
          type: "reference",
          topics: ["Atlas Memory"],
          score: 0.02,
          createdAt: Date.UTC(2026, 7, 2),
          memoryStatus: "current",
        },
        {
          _id: "atlas-migration",
          summary: "Atlas migration",
          snippet: "ATLAS-184 tracks the active migration.",
          type: "task",
          topics: ["Atlas Memory"],
          score: 0.019,
          createdAt: Date.UTC(2026, 7, 3),
          memoryStatus: "current",
        },
        {
          _id: "atlas-older-release",
          summary: "Atlas prior release",
          snippet: "Atlas Memory v2.7.0 preceded v2.7.1.",
          type: "reference",
          topics: ["Atlas Memory"],
          score: 0.018,
          createdAt: Date.UTC(2026, 6, 15),
          memoryStatus: "current",
        },
        {
          _id: "atlas-owner",
          summary: "Atlas project owner",
          snippet: "Noam owns Atlas Memory.",
          type: "person_note",
          topics: ["Atlas Memory"],
          score: 0.017,
          createdAt: Date.UTC(2026, 6, 10),
          memoryStatus: "current",
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "core-preference",
          content: "Jordan prefers concise, direct answers.",
          metadata: {
            type: "person_note",
            topics: ["communication"],
            people: ["Jordan"],
            actionItems: [],
            summary: "Communication preference",
          },
          createdAt: Date.UTC(2026, 7, 1),
          memoryStatus: "current",
          isCore: true,
        },
        {
          _id: "atlas-version",
          content: "Atlas Memory v2.7.1 addresses ATLAS-184.",
          metadata: {
            type: "reference",
            topics: ["Atlas Memory"],
            people: [],
            actionItems: [],
            summary: "Atlas Memory release",
          },
          createdAt: Date.UTC(2026, 7, 2),
          memoryStatus: "current",
        },
        {
          _id: "atlas-migration",
          content: "ATLAS-184 tracks the active migration.",
          metadata: {
            type: "task",
            topics: ["Atlas Memory"],
            people: [],
            actionItems: ["Complete ATLAS-184"],
            summary: "Atlas migration",
          },
          createdAt: Date.UTC(2026, 7, 3),
          memoryStatus: "current",
        },
      ]);

    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "recall_context",
        arguments: { query, limit: 5, includeHistorical: false },
      });
      // Nothing is stale, conflicting, or asked-for-and-absent, so the
      // memories are the whole result: no gaps block.
      expect((result as { content?: unknown[] }).content).toHaveLength(1);
      const firstContent = (result as { content?: unknown[] }).content?.[0];
      expect(firstContent).toMatchObject({ type: "text" });
      const context = JSON.parse(
        (firstContent as { type: "text"; text: string }).text,
      ) as Array<{ id: string; source: string; content: string }>;

      expect(context).toEqual([
        expect.objectContaining({ id: "fact-home", source: "core" }),
        expect.objectContaining({ id: "fact-role", source: "relevance" }),
        expect.objectContaining({
          id: "core-preference",
          source: "relevance",
          isCore: true,
        }),
        expect.objectContaining({
          id: "atlas-version",
          source: "relevance",
          content: "Atlas Memory v2.7.1 addresses ATLAS-184.",
        }),
        expect.objectContaining({
          id: "atlas-migration",
          source: "relevance",
        }),
      ]);
      // Core is asked for exactly the slots it can use, and core memories are
      // not fetched at all.
      expect(convexMocks.query).toHaveBeenCalledTimes(1);
      expect(convexMocks.query.mock.calls[0]?.[1]).toEqual({ limit: 1 });
      // Fact and thought search stay parallel and receive the same request.
      expect(convexMocks.action.mock.calls[0]?.[1]).toEqual({
        query,
        limit: 5,
        includeHistorical: false,
      });
      expect(convexMocks.action.mock.calls[1]?.[1]).toMatchObject({
        query,
        limit: 5,
        includeHistorical: false,
      });
      expect(convexMocks.action.mock.calls[2]?.[1]).toEqual({
        ids: ["core-preference", "atlas-version", "atlas-migration"],
      });
    } finally {
      vi.useRealTimers();
      await client.close();
      await server.close();
    }
  });

  test("spends a window of two entirely on the answer", async () => {
    convexMocks.action
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          _id: "atlas-version",
          summary: "Atlas Memory release",
          snippet: "Atlas Memory v2.7.1 addresses ATLAS-184.",
          type: "reference",
          topics: ["Atlas Memory"],
          score: 0.02,
          createdAt: Date.UTC(2026, 7, 2),
          memoryStatus: "current",
        },
        {
          _id: "atlas-migration",
          summary: "Atlas migration",
          snippet: "ATLAS-184 tracks the active migration.",
          type: "task",
          topics: ["Atlas Memory"],
          score: 0.019,
          createdAt: Date.UTC(2026, 7, 3),
          memoryStatus: "current",
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "atlas-version",
          content: "Atlas Memory v2.7.1 addresses ATLAS-184.",
          metadata: {
            type: "reference",
            topics: [],
            people: [],
            actionItems: [],
            summary: "Atlas Memory release",
          },
          createdAt: Date.UTC(2026, 7, 2),
          memoryStatus: "current",
        },
        {
          _id: "atlas-migration",
          content: "ATLAS-184 tracks the active migration.",
          metadata: {
            type: "task",
            topics: [],
            people: [],
            actionItems: [],
            summary: "Atlas migration",
          },
          createdAt: Date.UTC(2026, 7, 3),
          memoryStatus: "current",
        },
      ]);

    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "recall_context",
        arguments: { query: "Atlas Memory status?", limit: 2 },
      });
      const firstContent = (result as { content?: unknown[] }).content?.[0];
      const context = JSON.parse(
        (firstContent as { type: "text"; text: string }).text,
      ) as Array<{ id: string; source: string }>;

      expect(context.map((row) => row.id)).toEqual([
        "atlas-version",
        "atlas-migration",
      ]);
      // No core slot exists at this limit, so core is never queried; the only
      // reads are the two search actions and the hydration.
      expect(convexMocks.query).not.toHaveBeenCalled();
      expect(convexMocks.action.mock.calls[0]?.[1]).toMatchObject({
        query: "Atlas Memory status?",
        limit: 2,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("lists core facts and core memories without running a search", async () => {
    convexMocks.query
      .mockResolvedValueOnce([
        {
          id: "employer-fact",
          statement: "Jordan works at Atlas Memory.",
          subject: {
            id: "jordan",
            key: "person:jordan",
            kind: "person",
            name: "Jordan",
            aliases: [],
          },
          predicate: "employer",
          value: { type: "string", value: "Atlas Memory" },
          sourceType: "user_stated",
          confidence: 1,
          isCore: true,
          status: "current",
          createdAt: Date.UTC(2026, 7, 1),
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "core-preference",
          _creationTime: Date.UTC(2026, 7, 1),
          content: "Jordan prefers concise, direct answers.",
          metadata: {
            type: "person_note",
            topics: ["communication"],
            people: ["Jordan"],
            actionItems: [],
            summary: "Communication preference",
          },
          userId: "jordan",
          memoryStatus: "current",
          isCore: true,
        },
      ]);

    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const tool = (await client.listTools()).tools.find(
        (candidate) => candidate.name === "list_core_memories",
      );
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.inputSchema.properties).toHaveProperty("limit.maximum", 25);
      expect(tool?.inputSchema.properties).toHaveProperty("limit.default", 10);

      const result = await client.callTool({
        name: "list_core_memories",
        arguments: {},
      });
      const text = (result as { content?: Array<{ text?: string }> })
        .content?.[0]?.text;
      const core = JSON.parse(text ?? "{}") as {
        coreFacts: Array<Record<string, unknown>>;
        coreMemories: Array<Record<string, unknown>>;
      };

      expect(core.coreFacts).toEqual([
        expect.objectContaining({
          id: "employer-fact",
          citation: "fact:employer-fact",
          statement: "Jordan works at Atlas Memory.",
          memoryKind: "fact",
          source: "core",
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
      ]);
      expect(core.coreMemories).toEqual([
        expect.objectContaining({
          id: "core-preference",
          citation: "thought:core-preference",
          content: "Jordan prefers concise, direct answers.",
          memoryKind: "thought",
          source: "core",
          isCore: true,
          memoryStatus: "current",
        }),
      ]);
      expect(core).toMatchObject({ truncated: false });
      // Both stores are read at the default core limit; no search action runs.
      expect(convexMocks.query.mock.calls[0]?.[1]).toEqual({ limit: 10 });
      expect(convexMocks.query.mock.calls[1]?.[1]).toEqual({ limit: 10 });
      expect(convexMocks.action).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("holds list_core_memories to its advertised result budget", async () => {
    const longThought = (index: number) => ({
      _id: `core-${index}`,
      _creationTime: Date.UTC(2026, 7, 25 - index),
      content: `Memory ${index}. ${"x".repeat(5_000)}`,
      metadata: {
        type: "reference",
        topics: ["long"],
        people: [],
        actionItems: [],
        summary: `Memory ${index}`,
      },
      userId: "jordan",
      memoryStatus: "current",
      isCore: true,
    });
    convexMocks.query
      .mockResolvedValueOnce([
        {
          id: "employer-fact",
          statement: "Jordan works at Atlas Memory.",
          subject: null,
          predicate: "employer",
          value: { type: "string", value: "Atlas Memory" },
          sourceType: "user_stated",
          confidence: 1,
          isCore: true,
          status: "current",
          createdAt: Date.UTC(2026, 7, 1),
        },
      ])
      .mockResolvedValueOnce(
        Array.from({ length: 25 }, (_, index) => longThought(index)),
      );

    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "list_core_memories",
        arguments: { limit: 25 },
      });
      const text = (result as { content?: Array<{ text?: string }> })
        .content?.[0]?.text;
      expect(text).toBeDefined();
      expect(text!.length).toBeLessThanOrEqual(50_000);
      expect((result as { _meta?: Record<string, unknown> })._meta).toEqual({
        "anthropic/maxResultSizeChars": 50_000,
      });

      const core = JSON.parse(text!) as {
        coreFacts: Array<{ id: string }>;
        coreMemories: Array<{ id: string; content: string }>;
        truncated: boolean;
      };
      expect(core.truncated).toBe(true);
      // Memories are dropped from the tail before any fact goes.
      expect(core.coreFacts.map((fact) => fact.id)).toEqual(["employer-fact"]);
      expect(core.coreMemories.length).toBeGreaterThan(0);
      expect(core.coreMemories.length).toBeLessThan(25);
      expect(core.coreMemories.map((memory) => memory.id)).toEqual(
        core.coreMemories.map((_, index) => `core-${index}`),
      );
      for (const memory of core.coreMemories) {
        expect(memory.content.endsWith("…")).toBe(true);
      }
      expect(convexMocks.query.mock.calls[0]?.[1]).toEqual({ limit: 25 });
      expect(convexMocks.query.mock.calls[1]?.[1]).toEqual({ limit: 25 });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("reports what the brain does not know after the memories, and only then", async () => {
    // A fixed clock keeps the staleness verdicts below from drifting as the
    // calendar moves on; the fake covers Date only, so the MCP transport's
    // timers and promises are untouched.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 8, 2, 12) });
    const factRow = (
      id: string,
      predicate: string,
      value: string,
      createdAt: number,
    ) => ({
      id,
      statement: `Jordan — ${predicate.replaceAll("_", " ")}: ${value}.`,
      subject: {
        id: "entity-jordan",
        key: "person:jordan",
        kind: "person",
        name: "Jordan",
        aliases: [],
      },
      predicate,
      value: { type: "text", value },
      sourceType: "user_stated" as const,
      confidence: 1,
      isCore: false,
      status: "current" as const,
      createdAt,
    });
    // Two current facts disagree, the newest relevant memory is months old,
    // and the question asks for a phone number no fact records.
    convexMocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        factRow("fact-city-a", "home_city", "Fernwood", Date.UTC(2026, 2, 1)),
        factRow(
          "fact-city-b",
          "home_city",
          "Brightwater",
          Date.UTC(2026, 3, 1),
        ),
      ]);
    convexMocks.action
      .mockResolvedValueOnce([
        {
          _id: "moving-note",
          summary: "Jordan's move",
          snippet: "Jordan is moving house this spring.",
          type: "person_note",
          topics: ["Jordan"],
          score: 0.02,
          createdAt: Date.UTC(2026, 3, 10),
          memoryStatus: "current",
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "moving-note",
          content: "Jordan is moving house this spring.",
          metadata: {
            type: "person_note",
            topics: ["Jordan"],
            people: ["Jordan"],
            actionItems: [],
            summary: "Jordan's move",
          },
          createdAt: Date.UTC(2026, 3, 10),
          memoryStatus: "current",
        },
      ]);

    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "recall_context",
        arguments: {
          query:
            "Where does Jordan live now, and what is Jordan's phone number?",
          limit: 5,
        },
      });
      const content = (result as { content: Array<{ text: string }> }).content;
      expect(content).toHaveLength(3);
      // The memories block is unchanged: still a bare array a parser can read.
      const memories = JSON.parse(content[0]!.text) as Array<{ id: string }>;
      expect(memories.map((row) => row.id)).toEqual([
        "fact-city-a",
        "fact-city-b",
        "moving-note",
      ]);
      const { gaps } = JSON.parse(content[1]!.text) as {
        gaps: Array<{ kind: string; message: string; refs?: string[] }>;
      };
      expect(gaps.map((gap) => gap.kind)).toEqual([
        "conflict",
        "absent",
        "stale",
      ]);
      expect(gaps[0]).toMatchObject({
        refs: ["fact:fact-city-a", "fact:fact-city-b"],
      });
      expect(gaps[0]!.message).toContain("Two current facts disagree");
      expect(gaps[1]).toEqual({
        kind: "absent",
        message: "No fact recording a phone number was found for Jordan.",
      });
      expect(gaps[2]).toMatchObject({ refs: ["thought:moving-note"] });
      expect(gaps[2]!.message).toContain("since 2026-04-10");
      expect(content[2]!.text).toBe(
        [
          "What the brain doesn't know:",
          `- [conflict] ${gaps[0]!.message}`,
          `- [absent] ${gaps[1]!.message}`,
          `- [stale] ${gaps[2]!.message}`,
        ].join("\n"),
      );
    } finally {
      vi.useRealTimers();
      await client.close();
      await server.close();
    }
  });

  test("guides an empty brain to initialization without inventing a citation", async () => {
    convexMocks.query.mockResolvedValue([]);
    convexMocks.action.mockResolvedValue([]);
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "recall_context",
        arguments: { query: "What do you remember?" },
      });

      expect((result as { content?: unknown[] }).content).toEqual([
        {
          type: "text",
          text: "Run /brain-init to add initial context, then try recall_context again.",
        },
      ]);
      // One fact search, one thought search; nothing to hydrate.
      expect(convexMocks.action).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("passes explicit validity and core status through capture", async () => {
    convexMocks.action.mockResolvedValue({
      thoughtId: "captured",
      disposition: "stored",
      metadata: {
        type: "reference",
        topics: ["Atlas Memory"],
        people: [],
        actionItems: [],
        summary: "Atlas Memory release",
      },
    });
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "capture_thought",
        arguments: {
          content: "Atlas Memory v2.7.1 became current on August 10.",
          validFrom: "2026-08-10",
          validTo: "2026-08-11T12:00:00Z",
          isCore: false,
          sourceType: "user_stated",
        },
      });

      expect(result.isError).not.toBe(true);
      expect(convexMocks.action.mock.calls[0]?.[1]).toEqual({
        content: "Atlas Memory v2.7.1 became current on August 10.",
        validFrom: Date.UTC(2026, 7, 10),
        validTo: Date.parse("2026-08-11T12:00:00Z"),
        isCore: false,
        sourceType: "user_stated",
        sourceRef: undefined,
        observedAt: undefined,
        batchId: undefined,
      });
      expect(
        (result as { content?: Array<{ text?: string }> }).content?.[0]?.text,
      ).toContain("thought:captured");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("rejects a capture without sourceType at the schema instead of soft-failing", async () => {
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "capture_thought",
        arguments: {
          content: "Zevin started at Redwood Academy.",
        },
      });

      expect(result.isError).toBe(true);
      expect(convexMocks.action).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("marks an unstored capture as an error so callers cannot report it saved", async () => {
    convexMocks.action.mockResolvedValue({
      disposition: "needs_confirmation",
      operationSummary: "Memory was not stored: needs atomization",
      metadata: {
        type: "reference",
        topics: [],
        people: [],
        actionItems: [],
        summary: "unstored",
      },
    });
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "capture_thought",
        arguments: {
          content: "Zevin started at Redwood Academy.",
          sourceType: "user_stated",
        },
      });

      expect(result.isError).toBe(true);
      expect(
        (result as { content?: Array<{ text?: string }> }).content?.[0]?.text,
      ).toContain("not stored");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("forget_entity loops the batched mutation until done and cites every deletion", async () => {
    const batch = (overrides: Record<string, unknown>) => ({
      entityId: "entity-1",
      key: "person:dr-old",
      reason: "Third party captured by mistake",
      deletedSubjectFactIds: [],
      deletedReferencingFacts: [],
      detachedPredecessors: [],
      detachedSuccessors: [],
      ...overrides,
    });
    convexMocks.mutation
      .mockResolvedValueOnce(
        batch({
          done: false,
          deletedSubjectFactIds: ["fact-a", "fact-b"],
          // fact-c replaced fact-b, and still points at the entity.
          detachedSuccessors: ["fact-c"],
        }),
      )
      .mockResolvedValueOnce(
        batch({
          done: true,
          deletedReferencingFacts: [
            {
              factId: "fact-c",
              subjectEntityId: "entity-jordan",
              predicate: "primary_care_provider",
            },
          ],
          detachedSuccessors: ["fact-d"],
        }),
      );
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "forget_entity",
        arguments: { entityId: "entity-1", reason: "  Third party  " },
      });

      expect(result.isError).not.toBe(true);
      // One mutation per batch, same arguments each time, until done.
      expect(convexMocks.mutation).toHaveBeenCalledTimes(2);
      expect(convexMocks.mutation.mock.calls[1]?.[1]).toEqual(
        convexMocks.mutation.mock.calls[0]?.[1],
      );

      const [narrative, structured] = result.content as Array<{
        type: string;
        text: string;
      }>;
      // The narrative names only what it can cite; counts and id lists are
      // in the structured block.
      expect(narrative?.text).toContain("person:dr-old (entity-1)");
      expect(narrative?.text).not.toMatch(/\d+ fact/);
      expect(JSON.parse(structured!.text)).toEqual({
        entity: { id: "entity-1", key: "person:dr-old" },
        reason: "Third party captured by mistake",
        done: true,
        batches: 2,
        deletedFactsAboutEntity: ["fact:fact-a", "fact:fact-b"],
        deletedFactsPointingAtEntity: [
          {
            citation: "fact:fact-c",
            predicate: "primary_care_provider",
            subjectEntityId: "entity-jordan",
          },
        ],
        // fact-c was detached in batch 1 and deleted in batch 2, so only
        // fact-d survives as a replacement.
        survivingReplacements: ["fact:fact-d"],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("passes a typed relationship fact with explicit provenance and time", async () => {
    // remember_fact is an action: the fact commits, then its search text is
    // embedded, and the write must not depend on that second step.
    convexMocks.action.mockResolvedValue({
      factId: "pcp-fact",
      statement: "Jordan — primary care provider: Dr. Rivera.",
      operation: "stored",
    });
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "memory-quality-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "remember_fact",
        arguments: {
          subject: {
            key: "person:jordan",
            kind: "person",
            name: "Jordan",
          },
          predicate: "primary_care_provider",
          value: {
            type: "entity",
            entity: {
              key: "person:dr-rivera",
              kind: "person",
              name: "Dr. Rivera",
            },
          },
          sourceType: "user_stated",
          sourceRef: "current conversation",
          observedAt: "2026-08-11T14:00:00-07:00",
          validFrom: "2026-08-01",
          cardinality: "single",
          changeKind: "changed",
        },
      });

      expect(result.isError).not.toBe(true);
      expect(convexMocks.mutation).not.toHaveBeenCalled();
      expect(convexMocks.action.mock.calls[0]?.[1]).toEqual({
        subject: {
          key: "person:jordan",
          kind: "person",
          name: "Jordan",
        },
        predicate: "primary_care_provider",
        value: {
          type: "entity",
          entity: {
            key: "person:dr-rivera",
            kind: "person",
            name: "Dr. Rivera",
          },
        },
        sourceType: "user_stated",
        sourceRef: "current conversation",
        observedAt: Date.parse("2026-08-11T21:00:00Z"),
        batchId: undefined,
        isCore: undefined,
        validFrom: Date.UTC(2026, 7, 1),
        validTo: undefined,
        cardinality: "single",
        changeKind: "changed",
        changeReason: undefined,
      });
      expect(
        (result as { content?: Array<{ text?: string }> }).content?.[0]?.text,
      ).toContain("fact:pcp-fact");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("parses explicit validity dates without using local server time", () => {
    expect(parseValidityTimestamp("2026-08-10")).toBe(Date.UTC(2026, 7, 10));
    expect(parseValidityTimestamp("2026-08-10T15:30:00-07:00")).toBe(
      Date.parse("2026-08-10T22:30:00Z"),
    );
    expect(parseValidityWindow("2026-08-10", "2026-08-11")).toEqual({
      validFrom: Date.UTC(2026, 7, 10),
      validTo: Date.UTC(2026, 7, 11),
    });
  });

  test("rejects inferred-local, impossible, and non-positive validity windows", () => {
    expect(() => parseValidityTimestamp("2026-08-10T15:30:00")).toThrow(
      "timezone-qualified datetime",
    );
    expect(() => parseValidityTimestamp("2026-02-30")).toThrow(
      "not a real calendar date",
    );
    expect(() => parseValidityTimestamp("next Tuesday")).toThrow(
      "ISO-8601 date",
    );
    expect(() => parseValidityWindow("2026-08-11", "2026-08-10")).toThrow(
      "validFrom must be earlier than validTo",
    );
    expect(() => parseValidityWindow("2026-08-10", "2026-08-10")).toThrow(
      "validFrom must be earlier than validTo",
    );
  });
});
