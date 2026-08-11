import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "@repo/db/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import { MCP_TOOL_NAMES } from "@/lib/mcp/tools";

const SERVER_INSTRUCTIONS = `AI Brain is durable personal memory. Use capture_thought automatically when the user reveals information that will likely matter in a future conversation: stable personal facts and preferences, relationships, project context or status changes, decisions and their rationale, commitments, and recurring working patterns. Do not wait for an explicit "remember this" request. Do not capture transient small talk, speculative ideas presented only for discussion, passwords, authentication tokens, or other credentials. Send changed information to capture_thought once; the server will preserve prior states as linked history. For present-tense questions, search current memories (the default). Set includeHistorical only when the user asks what used to be true, how something changed, or for a history/timeline. Routine successful captures can remain unobtrusive.`;

export function createMcpServer(convexAuthToken: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(convexAuthToken);

  const server = new McpServer(
    {
      name: "open-brain",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.tool(
    MCP_TOOL_NAMES.searchThoughts,
    "Search stored thoughts by meaning AND keyword (hybrid). Current memories are searched by default. Set includeHistorical for questions about prior states, corrections, or how something changed. Returns a compact index — `id`, summary, short snippet, type, topics, lifecycle status, score. Use `get_thoughts` to fetch full content. Cite sources as `thought:<id>`.",
    {
      query: z.string().describe("Natural language or keyword query"),
      type: z
        .enum([
          "decision",
          "person_note",
          "idea",
          "meeting_note",
          "task",
          "reference",
        ])
        .optional()
        .describe("Optional type filter"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results to return"),
      includeHistorical: z
        .boolean()
        .default(false)
        .describe(
          "Include superseded and retracted memories for historical questions",
        ),
    },
    async ({ query, type, limit, includeHistorical }) => {
      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        score: number;
        createdAt: number;
        memoryStatus: "current" | "superseded" | "retracted";
        supersededAt?: number;
        changeReason?: string;
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.search,
        {
          query,
          type,
          limit,
          includeHistorical,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching thoughts found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                score: r.score,
                memoryStatus: r.memoryStatus,
                supersededAt: r.supersededAt
                  ? new Date(r.supersededAt).toISOString()
                  : undefined,
                changeReason: r.changeReason,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.browseRecent,
    "Browse most recent current thoughts, optionally filtered by type or topic. Set includeHistorical to include superseded and corrected memories. Cite sources as `thought:<id>`.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("How many thoughts to return"),
      type: z
        .enum([
          "decision",
          "person_note",
          "idea",
          "meeting_note",
          "task",
          "reference",
        ])
        .optional()
        .describe("Filter by thought type"),
      topic: z.string().optional().describe("Filter by topic keyword"),
      includeHistorical: z
        .boolean()
        .default(false)
        .describe("Include superseded and retracted memories"),
    },
    async ({ limit, type, topic, includeHistorical }) => {
      type Thought = {
        _id: string;
        _creationTime: number;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        userId: string;
        memoryStatus?: "current" | "superseded" | "retracted";
        supersededAt?: number;
        changeReason?: string;
      };
      const results: Thought[] = await convex.query(
        api.models.thoughts.mcpQueries.listByUser,
        { limit, includeHistorical },
      );

      let filtered = results;
      if (type) {
        filtered = filtered.filter((t) => t.metadata.type === type);
      }
      if (topic) {
        const lowerTopic = topic.toLowerCase();
        filtered = filtered.filter((t) =>
          t.metadata.topics.some((tp) => tp.toLowerCase().includes(lowerTopic)),
        );
      }

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found matching the criteria.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              filtered.map((t) => ({
                id: t._id,
                content: t.content,
                metadata: t.metadata,
                memoryStatus: t.memoryStatus ?? "current",
                supersededAt: t.supersededAt
                  ? new Date(t.supersededAt).toISOString()
                  : undefined,
                changeReason: t.changeReason,
                createdAt: new Date(t._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getThoughts,
    "Fetch full content and lifecycle links for specific thought IDs. Use after `search_thoughts` and batch multiple IDs in one call. Treat current memories as authoritative; superseded memories were formerly current, while retracted memories were inaccurate.",
    {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Thought IDs (from a prior search_thoughts call)"),
    },
    async ({ ids }) => {
      type Thought = {
        _id: string;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        createdAt: number;
        updatedAt?: number;
        memoryStatus: "current" | "superseded" | "retracted";
        supersededAt?: number;
        supersededBy?: string;
        supersedes?: string[];
        changeReason?: string;
      };
      const results: Thought[] = await convex.action(
        api.models.thoughts.mcpActions.getByIds,
        { ids: ids as never },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found for the provided IDs.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                content: r.content,
                metadata: r.metadata,
                createdAt: new Date(r.createdAt).toISOString(),
                updatedAt: r.updatedAt
                  ? new Date(r.updatedAt).toISOString()
                  : undefined,
                memoryStatus: r.memoryStatus,
                supersededAt: r.supersededAt
                  ? new Date(r.supersededAt).toISOString()
                  : undefined,
                supersededBy: r.supersededBy,
                supersedes: r.supersedes,
                changeReason: r.changeReason,
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.timelineThoughts,
    "Fetch thoughts captured around a specific point in time. Provide either `seedId` (anchor on another thought) or `aroundMs` (epoch ms). Returns compact index rows ordered oldest→newest — use `get_thoughts` for full content. Cite sources as `thought:<id>`.",
    {
      seedId: z
        .string()
        .optional()
        .describe("Thought ID to anchor the window around"),
      aroundMs: z
        .number()
        .optional()
        .describe("Epoch milliseconds to anchor the window around"),
      before: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from before the anchor"),
      after: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from after the anchor"),
      type: z
        .enum([
          "decision",
          "person_note",
          "idea",
          "meeting_note",
          "task",
          "reference",
        ])
        .optional()
        .describe("Optional type filter"),
    },
    async ({ seedId, aroundMs, before, after, type }) => {
      if (!seedId && aroundMs === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: provide either `seedId` or `aroundMs`.",
            },
          ],
          isError: true,
        };
      }
      if (seedId && aroundMs !== undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: provide only one of `seedId` or `aroundMs`, not both.",
            },
          ],
          isError: true,
        };
      }

      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        createdAt: number;
        memoryStatus: "current" | "superseded" | "retracted";
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.timeline,
        {
          seedId: seedId as never,
          aroundMs,
          before,
          after,
          type,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found in the requested window.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                memoryStatus: r.memoryStatus,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getStats,
    "Get overview statistics of what's stored in your brain",
    {},
    async () => {
      const stats = await convex.query(
        api.models.thoughts.mcpQueries.getStats,
        {},
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.captureThought,
    "Automatically save durable information for future conversations: personal facts and preferences, people and relationships, project context or status, decisions, commitments, and recurring patterns. Call this without waiting for an explicit request whenever such information appears. The server deduplicates and preserves changed or corrected prior information as linked history.",
    {
      content: z
        .string()
        .describe(
          "A standalone durable memory. State what is true now and include useful context from the conversation.",
        ),
    },
    async ({ content }) => {
      type CaptureResult = {
        thoughtId: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        operationSummary?: string;
      };
      const result: CaptureResult = await convex.action(
        api.models.thoughts.mcpActions.capture,
        { content },
      );

      const noopSummary = "Thought already captured — no changes made";
      const statusLine = result.operationSummary
        ? result.operationSummary === noopSummary
          ? `${result.operationSummary}.`
          : `Thought captured. ${result.operationSummary}.`
        : "Thought captured successfully.";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              statusLine,
              "",
              `Type: ${result.metadata.type}`,
              `Topics: ${result.metadata.topics.join(", ") || "none"}`,
              `People: ${result.metadata.people.join(", ") || "none"}`,
              `Summary: ${result.metadata.summary}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.createReport,
    "Create a workflow analysis report with structured insights",
    {
      startDate: z.string().describe("Report period start date (ISO format)"),
      endDate: z.string().describe("Report period end date (ISO format)"),
      sessionsAnalyzed: z.number().describe("Number of sessions analyzed"),
      totalPrompts: z.number().describe("Total prompts in period"),
      totalToolCalls: z.number().describe("Total tool calls in period"),
      projectsActive: z
        .array(z.object({ path: z.string(), sessions: z.number() }))
        .describe("Active projects with session counts"),
      modelUsage: z
        .record(z.string(), z.number())
        .describe("Model usage counts keyed by model name"),
      insights: z
        .array(
          z.object({
            category: z.enum([
              "feature-discovery",
              "anti-pattern",
              "productivity",
              "automation",
              "ecosystem",
            ]),
            observation: z.string(),
            recommendation: z.string(),
            evidence: z.string(),
            links: z
              .array(
                z.object({
                  label: z.string().describe("Display text for the link"),
                  url: z.string().describe("URL to link to"),
                }),
              )
              .optional()
              .describe("Related links (docs, plugins, tools)"),
          }),
        )
        .describe("Structured insights from the analysis"),
    },
    async (args) => {
      type CreateReportResult = {
        reportId: string;
        insightIds: string[];
      };
      const result: CreateReportResult = await convex.action(
        api.models.reports.mcpActions.createReport,
        args,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Report created successfully.",
              "",
              `Report ID: ${result.reportId}`,
              `Insights created: ${result.insightIds.length}`,
              `Period: ${args.startDate} to ${args.endDate}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getInsights,
    "Get workflow insights, optionally filtered by status or category. Cite insights as `insight:<id>` when referencing them in your response.",
    {
      status: z
        .enum(["new", "noted", "done", "dismissed"])
        .optional()
        .describe("Filter by insight status"),
      category: z
        .enum([
          "feature-discovery",
          "anti-pattern",
          "productivity",
          "automation",
          "ecosystem",
        ])
        .optional()
        .describe("Filter by insight category"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Max results to return"),
    },
    async ({ status, category, limit }) => {
      type Insight = {
        _id: string;
        _creationTime: number;
        category: string;
        observation: string;
        recommendation: string;
        evidence: string;
        links?: { label: string; url: string }[];
        status: string;
        dismissTag?: string;
        dismissText?: string;
      };
      const results: Insight[] = await convex.query(
        api.models.reports.mcpQueries.listInsights,
        { status, category, limit },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No insights found matching the criteria.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((i) => ({
                id: i._id,
                category: i.category,
                observation: i.observation,
                recommendation: i.recommendation,
                evidence: i.evidence,
                links: i.links,
                status: i.status,
                dismissTag: i.dismissTag,
                dismissText: i.dismissText,
                createdAt: new Date(i._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.deleteInsight,
    "Delete a specific insight by ID",
    {
      insightId: z.string().describe("The ID of the insight to delete"),
    },
    async ({ insightId }) => {
      await convex.mutation(api.models.reports.mcpMutations.deleteInsight, {
        insightId: insightId as never,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "Insight deleted successfully.",
          },
        ],
      };
    },
  );

  // --- Lists ---

  server.tool(
    MCP_TOOL_NAMES.createList,
    "Create a new named list for tracking items (todos, goals, etc.)",
    {
      name: z
        .string()
        .describe("Name for the list (e.g., 'This Week', 'Q2 Goals')"),
      pinned: z
        .boolean()
        .default(false)
        .describe(
          "If true, this list is loaded proactively by AI tools at session start",
        ),
    },
    async ({ name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createList,
        { name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List created: "${result.name}"${result.pinned ? " (pinned)" : ""}\nList ID: ${result.listId}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.updateList,
    "Update a list's name or pinned status",
    {
      listId: z.string().describe("The list ID to update"),
      name: z.string().optional().describe("New name for the list"),
      pinned: z.boolean().optional().describe("Set pinned status"),
    },
    async ({ listId, name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateList,
        { listId: listId as never, name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List updated: "${result.name}"${result.pinned ? " (pinned)" : ""}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getLists,
    "Get all lists with item counts, optionally filtered to pinned only",
    {
      pinned: z.boolean().optional().describe("Filter to pinned lists only"),
      includeArchived: z
        .boolean()
        .default(false)
        .describe("Include archived lists"),
    },
    async ({ pinned, includeArchived }) => {
      type ListResult = {
        listId: string;
        name: string;
        pinned: boolean;
        archivedAt?: number;
        counts: { total: number; open: number; done: number };
      };
      const results: ListResult[] = await convex.query(
        api.models.lists.mcpQueries.getLists,
        { pinned, includeArchived },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No lists found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 100000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getList,
    "Get a single list with its ordered items",
    {
      listId: z.string().describe("The list ID to fetch"),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include completed items (excluded by default)"),
    },
    async ({ listId, includeCompleted }) => {
      type ListDetail = {
        listId: string;
        name: string;
        pinned: boolean;
        items: Array<{
          itemId: string;
          title: string;
          status: string;
          position: number;
          completedAt?: number;
          url?: string;
          description?: string;
          properties?: Record<string, unknown>;
        }>;
      };
      const result: ListDetail = await convex.query(
        api.models.lists.mcpQueries.getList,
        { listId: listId as never, includeCompleted },
      );

      const itemLines =
        result.items.length > 0
          ? result.items.map((i) => {
              let line = `${i.status === "done" ? "[x]" : "[ ]"} ${i.title} (id: ${i.itemId})`;
              if (i.url) line += `\n    URL: ${i.url}`;
              if (i.description) line += `\n    ${i.description}`;
              if (i.properties)
                line += `\n    Properties: ${JSON.stringify(i.properties)}`;
              return line;
            })
          : ["(no items)"];

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${result.name}${result.pinned ? " (pinned)" : ""}`,
              `List ID: ${result.listId}`,
              "",
              ...itemLines,
            ].join("\n"),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.archiveList,
    "Archive a list (soft delete — items remain intact for review)",
    {
      listId: z.string().describe("The list ID to archive"),
    },
    async ({ listId }) => {
      await convex.mutation(api.models.lists.mcpActions.archiveList, {
        listId: listId as never,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "List archived.",
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.createListItem,
    "Add an item to a list",
    {
      listId: z.string().describe("The list to add the item to"),
      title: z.string().describe("The item text"),
      url: z.string().optional().describe("Optional URL for the item"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the item"),
      properties: z
        .record(z.string(), z.any())
        .optional()
        .describe("Optional custom properties object"),
    },
    async ({ listId, title, url, description, properties }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createListItem,
        { listId: listId as never, title, url, description, properties },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Added: "${result.title}" (id: ${result.itemId})`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.updateListItem,
    "Update a list item — change title, mark done/open, or reorder",
    {
      itemId: z.string().describe("The item ID to update"),
      title: z.string().optional().describe("New title text"),
      status: z
        .enum(["open", "done"])
        .optional()
        .describe("Set status (done = check off, open = reopen)"),
      position: z.number().optional().describe("New position for reordering"),
      url: z.string().optional().describe("New URL for the item"),
      description: z
        .string()
        .optional()
        .describe("New description for the item"),
      properties: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Custom properties object (replaces entire properties field — caller should merge with existing before sending)",
        ),
    },
    async ({
      itemId,
      title,
      status,
      position,
      url,
      description,
      properties,
    }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateListItem,
        {
          itemId: itemId as never,
          title,
          status,
          position,
          url,
          description,
          properties,
        },
      );

      const statusText = result.status === "done" ? " [done]" : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated: "${result.title}"${statusText}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getOpenItems,
    "Get all open items across all active (non-archived) lists",
    {
      limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Max items to return"),
    },
    async ({ limit }) => {
      type OpenItem = {
        itemId: string;
        title: string;
        position: number;
        listId: string;
        listName: string;
        url?: string;
        description?: string;
        properties?: Record<string, unknown>;
      };
      const results: OpenItem[] = await convex.query(
        api.models.lists.mcpQueries.getOpenItems,
        { limit },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No open items.",
            },
          ],
        };
      }

      // Group by list name for readable output
      const byList = new Map<string, OpenItem[]>();
      for (const item of results) {
        const group = byList.get(item.listName) ?? [];
        group.push(item);
        byList.set(item.listName, group);
      }

      const lines: string[] = [];
      for (const [listName, items] of byList) {
        lines.push(`## ${listName}`);
        for (const item of items) {
          let line = `- [ ] ${item.title} (id: ${item.itemId})`;
          if (item.url) line += `\n    URL: ${item.url}`;
          if (item.description) line += `\n    ${item.description}`;
          if (item.properties)
            line += `\n    Properties: ${JSON.stringify(item.properties)}`;
          lines.push(line);
        }
        lines.push("");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );

  return server;
}
