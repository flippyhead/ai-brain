import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "@repo/db/convex/_generated/api";
import { z } from "zod";

export function createMcpServer(userId: string) {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAdminAuth(process.env.CONVEX_DEPLOYMENT!);

  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  server.tool(
    "search_thoughts",
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
      const results = await convex.action(
        internal.models.thoughts.actions.searchByVector,
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
    "browse_recent",
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
      const results = await convex.query(
        internal.models.thoughts.private.listByUser,
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
    "get_stats",
    "Get overview statistics of what's stored in your brain",
    {},
    async () => {
      const thoughts = await convex.query(
        internal.models.thoughts.private.listByUser,
        { userId: userId as never, limit: 10000 },
      );

      const typeCounts = new Map<string, number>();
      const topicCounts = new Map<string, number>();
      const peopleCounts = new Map<string, number>();

      for (const t of thoughts) {
        typeCounts.set(
          t.metadata.type,
          (typeCounts.get(t.metadata.type) ?? 0) + 1,
        );
        for (const topic of t.metadata.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
        for (const person of t.metadata.people) {
          peopleCounts.set(person, (peopleCounts.get(person) ?? 0) + 1);
        }
      }

      const stats = {
        totalThoughts: thoughts.length,
        byType: [...typeCounts.entries()]
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
        topTopics: [...topicCounts.entries()]
          .map(([topic, count]) => ({ topic, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        topPeople: [...peopleCounts.entries()]
          .map(([person, count]) => ({ person, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      };

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
    "capture_thought",
    "Save a new thought, decision, note, or idea to your brain",
    {
      content: z.string().describe("The thought content to save"),
    },
    async ({ content }) => {
      const result = await convex.action(
        internal.models.thoughts.actions.captureThought,
        { userId: userId as never, content },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Thought captured successfully.",
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

  return server;
}
