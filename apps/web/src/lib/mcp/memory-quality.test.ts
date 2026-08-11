import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const convexMocks = vi.hoisted(() => ({
  action: vi.fn(),
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = convexMocks.action;
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
        "Never turn assistant suggestions, guesses, deductions, or unconfirmed implications into facts",
      );
      expect(instructions).toContain("version strings");
      expect(instructions).toContain("Mark isCore true only");
      expect(instructions).toContain("client-mediated");

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...MCP_MEMORY_TOOL_NAMES].sort(),
      );
      for (const tool of tools) {
        expect(tool.annotations).toEqual(
          MCP_TOOL_ANNOTATIONS[tool.name as keyof typeof MCP_TOOL_ANNOTATIONS],
        );
      }
      const recall = tools.find((tool) => tool.name === "recall_context");
      const capture = tools.find((tool) => tool.name === "capture_thought");

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
      expect(recall?.description).toContain("core memories");
      expect(recall?.inputSchema.properties).toHaveProperty("query");
      expect(capture?.description).toContain(
        "Do not save assistant suggestions, guesses, or inferences as user facts",
      );
      expect(capture?.description).toContain("version strings");
      expect(capture?.inputSchema.properties).toHaveProperty("validFrom");
      expect(capture?.inputSchema.properties).toHaveProperty("validTo");
      expect(capture?.inputSchema.properties).toHaveProperty("isCore");
      expect(capture?.inputSchema.properties).toHaveProperty(
        "content.maxLength",
        20_000,
      );
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

  test("exposes and annotates legacy productivity tools only in the full profile", async () => {
    process.env.MCP_TOOL_PROFILE = "full";
    const server = createMcpServer("test-convex-auth-token");
    const client = new Client({ name: "full-profile-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...MCP_TOOL_NAME_LIST].sort(),
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

  test("returns current core context before deduplicated relevance hits", async () => {
    const query = "What changed in Atlas Memory v2.7.1 for ticket ATLAS-184?";
    convexMocks.query.mockResolvedValue([
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
      {
        _id: "core-home",
        _creationTime: Date.UTC(2026, 6, 31),
        content: "Jordan lives in Los Angeles.",
        metadata: {
          type: "person_note",
          topics: ["location"],
          people: ["Jordan"],
          actionItems: [],
          summary: "Home location",
        },
        userId: "jordan",
        memoryStatus: "current",
        isCore: true,
      },
      {
        _id: "core-constraint",
        _creationTime: Date.UTC(2026, 6, 30),
        content: "Jordan avoids meetings before 9 AM.",
        metadata: {
          type: "person_note",
          topics: ["scheduling"],
          people: ["Jordan"],
          actionItems: [],
          summary: "Scheduling constraint",
        },
        userId: "jordan",
        memoryStatus: "current",
        isCore: true,
      },
    ]);
    convexMocks.action
      .mockResolvedValueOnce([
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
        expect.objectContaining({
          id: "core-preference",
          source: "core",
        }),
        expect.objectContaining({ id: "core-home", source: "core" }),
        expect.objectContaining({ id: "core-constraint", source: "core" }),
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
      expect(convexMocks.action.mock.calls[0]?.[1]).toMatchObject({
        query,
        limit: 5,
        includeHistorical: false,
      });
      expect(convexMocks.query.mock.calls[0]?.[1]).toEqual({ limit: 3 });
      expect(convexMocks.action.mock.calls[1]?.[1]).toEqual({
        ids: ["atlas-version", "atlas-migration"],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("passes explicit validity and core status through capture", async () => {
    convexMocks.action.mockResolvedValue({
      thoughtId: "captured",
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
        },
      });

      expect(result.isError).not.toBe(true);
      expect(convexMocks.action.mock.calls[0]?.[1]).toEqual({
        content: "Atlas Memory v2.7.1 became current on August 10.",
        validFrom: Date.UTC(2026, 7, 10),
        validTo: Date.parse("2026-08-11T12:00:00Z"),
        isCore: false,
      });
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
