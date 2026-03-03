"use node";

import { internalAction } from "../../_generated/server";
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
