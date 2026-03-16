import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/db/convex/_generated/api";
import { z } from "zod";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools";

export function createMcpServer(userId: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  const convex = new ConvexHttpClient(convexUrl);

  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  server.tool(
    MCP_TOOL_NAMES.searchThoughts,
    "Semantic search across all stored thoughts by meaning",
    {
      query: z.string().describe("Natural language search query"),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Similarity threshold (0-1)"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results to return"),
    },
    async ({ query, threshold, limit }) => {
      type SearchResult = {
        _id: string;
        content: string;
        metadata: { type: string; topics: string[]; people: string[]; actionItems: string[]; summary: string };
        score: number;
        createdAt: number;
      };
      const results: SearchResult[] = await convex.action(
        api.models.thoughts.mcpActions.search,
        {
          userId: userId as never,
          query,
          threshold,
          limit,
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
                content: r.content,
                metadata: r.metadata,
                similarityScore: r.score,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.browseRecent,
    "Browse most recent thoughts, optionally filtered by type or topic",
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
    },
    async ({ limit, type, topic }) => {
      type Thought = {
        _id: string;
        _creationTime: number;
        content: string;
        metadata: { type: string; topics: string[]; people: string[]; actionItems: string[]; summary: string };
        userId: string;
      };
      const results: Thought[] = await convex.query(
        api.models.thoughts.mcpQueries.listByUser,
        { userId: userId as never, limit },
      );

      let filtered = results;
      if (type) {
        filtered = filtered.filter((t) => t.metadata.type === type);
      }
      if (topic) {
        const lowerTopic = topic.toLowerCase();
        filtered = filtered.filter((t) =>
          t.metadata.topics.some((tp) =>
            tp.toLowerCase().includes(lowerTopic),
          ),
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
                content: t.content,
                metadata: t.metadata,
                createdAt: new Date(t._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
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
        { userId: userId as never },
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
    "Save a new thought, decision, note, or idea to your brain",
    {
      content: z.string().describe("The thought content to save"),
    },
    async ({ content }) => {
      type CaptureResult = {
        thoughtId: string;
        metadata: { type: string; topics: string[]; people: string[]; actionItems: string[]; summary: string };
        operationSummary?: string;
      };
      const result: CaptureResult = await convex.action(
        api.models.thoughts.mcpActions.capture,
        { userId: userId as never, content },
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
        { userId: userId as never, ...args },
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
    "Get workflow insights, optionally filtered by status or category",
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
        { userId: userId as never, status, category, limit },
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
      };
    },
  );

  // --- Lists ---

  server.tool(
    MCP_TOOL_NAMES.createList,
    "Create a new named list for tracking items (todos, goals, etc.)",
    {
      name: z.string().describe("Name for the list (e.g., 'This Week', 'Q2 Goals')"),
      pinned: z
        .boolean()
        .default(false)
        .describe("If true, this list is loaded proactively by AI tools at session start"),
    },
    async ({ name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createList,
        { userId: userId as never, name, pinned },
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
        { userId: userId as never, listId: listId as never, name, pinned },
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
      pinned: z
        .boolean()
        .optional()
        .describe("Filter to pinned lists only"),
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
        { userId: userId as never, pinned, includeArchived },
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
        }>;
      };
      const result: ListDetail = await convex.query(
        api.models.lists.mcpQueries.getList,
        { userId: userId as never, listId: listId as never, includeCompleted },
      );

      const itemLines = result.items.length > 0
        ? result.items.map(
            (i) =>
              `${i.status === "done" ? "[x]" : "[ ]"} ${i.title} (id: ${i.itemId})`,
          )
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
      await convex.mutation(
        api.models.lists.mcpActions.archiveList,
        { userId: userId as never, listId: listId as never },
      );
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
    },
    async ({ listId, title }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createListItem,
        { userId: userId as never, listId: listId as never, title },
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
      position: z
        .number()
        .optional()
        .describe("New position for reordering"),
    },
    async ({ itemId, title, status, position }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateListItem,
        {
          userId: userId as never,
          itemId: itemId as never,
          title,
          status,
          position,
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
      };
      const results: OpenItem[] = await convex.query(
        api.models.lists.mcpQueries.getOpenItems,
        { userId: userId as never, limit },
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
          lines.push(`- [ ] ${item.title} (id: ${item.itemId})`);
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
      };
    },
  );

  return server;
}
