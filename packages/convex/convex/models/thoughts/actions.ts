"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";

export const generateEmbedding = internalAction({
  args: { text: v.string() },
  returns: v.array(v.float64()),
  handler: async (_ctx, args): Promise<number[]> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: args.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0]!.embedding;
  },
});

export const extractMetadata = internalAction({
  args: { text: v.string() },
  returns: thoughtMetadata,
  handler: async (_ctx, args) => {
    const fallback = {
      type: "reference" as const,
      topics: [] as string[],
      people: [] as string[],
      actionItems: [] as string[],
      summary: args.text.slice(0, 100),
    };

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: `Extract metadata from the following thought/note. Return ONLY valid JSON with this exact structure:
{
  "type": "decision" | "person_note" | "idea" | "meeting_note" | "task" | "reference",
  "topics": ["topic1", "topic2"] (1-3 keyword topics),
  "people": ["Name1"] (names mentioned, empty array if none),
  "actionItems": ["item1"] (action items if any, empty array if none),
  "summary": "One-line summary"
}`,
          messages: [{ role: "user", content: args.text }],
        }),
      });

      if (!response.ok) {
        console.error(
          `Anthropic metadata extraction failed: ${response.statusText}`,
        );
        return fallback;
      }

      const data = (await response.json()) as {
        content: Array<{ text: string }>;
      };
      const text = data.content[0]!.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const validTypes = [
        "decision",
        "person_note",
        "idea",
        "meeting_note",
        "task",
        "reference",
      ];
      const parsedType = String(parsed.type);

      return {
        type: (
          validTypes.includes(parsedType) ? parsedType : "reference"
        ) as typeof fallback.type,
        topics: Array.isArray(parsed.topics)
          ? (parsed.topics as string[])
          : [],
        people: Array.isArray(parsed.people)
          ? (parsed.people as string[])
          : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? (parsed.actionItems as string[])
          : [],
        summary:
          typeof parsed.summary === "string"
            ? parsed.summary
            : args.text.slice(0, 100),
      };
    } catch (error) {
      console.error("Metadata extraction error:", error);
      return fallback;
    }
  },
});

export const captureThought = internalAction({
  args: {
    userId: v.id("users"),
    content: v.string(),
  },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
  }),
  handler: async (ctx, args) => {
    // Run embedding and metadata extraction in parallel
    const [embedding, metadata] = await Promise.all([
      ctx.runAction(internal.models.thoughts.actions.generateEmbedding, {
        text: args.content,
      }),
      ctx.runAction(internal.models.thoughts.actions.extractMetadata, {
        text: args.content,
      }),
    ]);

    const thoughtId = await ctx.runMutation(
      internal.models.thoughts.private.insertOne,
      {
        content: args.content,
        embedding,
        metadata,
        userId: args.userId,
      },
    );

    return { thoughtId, metadata };
  },
});

export const searchByVector = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    threshold: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      score: v.float64(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const threshold = args.threshold ?? 0.5;
    const limit = args.limit ?? 10;

    const embedding = await ctx.runAction(
      internal.models.thoughts.actions.generateEmbedding,
      { text: args.query },
    );

    const results = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    // Post-filter by threshold and limit
    const filtered = results
      .filter((r) => r._score >= threshold)
      .slice(0, limit);

    // Fetch full documents
    const docs = await Promise.all(
      filtered.map(async (r) => {
        const doc = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: r._id },
        );
        return doc
          ? {
              _id: r._id,
              content: doc.content,
              metadata: doc.metadata,
              score: r._score,
              createdAt: doc._creationTime,
            }
          : null;
      }),
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
