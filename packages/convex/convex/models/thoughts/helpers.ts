"use node";

import { internalAction } from "../../_generated/server";
import { v } from "convex/values";

export const EMBEDDING_DIMENSIONS = 1536;

export const generateEmbedding = internalAction({
  args: { text: v.string() },
  returns: v.array(v.float64()),
  handler: async (_ctx, args): Promise<number[]> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      data?: Array<{ embedding?: unknown }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      )
    ) {
      throw new Error("OpenAI embedding returned an invalid vector");
    }
    return embedding;
  },
});
