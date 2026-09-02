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
