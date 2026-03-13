"use node";

import { internalAction } from "../../_generated/server";
import { v } from "convex/values";

/** Minimum similarity score to consider a thought as a classification candidate. */
export const SIMILARITY_THRESHOLD = 0.7;

/** Maximum number of similar thoughts sent to the classifier. */
export const MAX_CANDIDATES = 10;

const classificationResponseSchema = v.object({
  operations: v.array(
    v.object({
      action: v.union(v.literal("UPDATE"), v.literal("DELETE")),
      thoughtId: v.string(),
      reason: v.string(),
      mergedContent: v.optional(v.string()),
    }),
  ),
  addNew: v.boolean(),
});

type ClassificationResponse = {
  operations: Array<{
    action: "UPDATE" | "DELETE";
    thoughtId: string;
    reason: string;
    mergedContent?: string;
  }>;
  addNew: boolean;
};

type CandidateThought = {
  _id: string;
  content: string;
  metadata: {
    type: string;
    topics: string[];
    people: string[];
    summary: string;
  };
  createdAt: number;
};

const SYSTEM_PROMPT = `You are a memory manager for a personal knowledge base. You are given new content being saved, along with existing similar entries (each with an id, content, metadata, and creation date).

Your job: determine if the new content UPDATES, REPLACES, or is INDEPENDENT of each existing entry.

Guidelines:
- UPDATE when the new content is clearly a newer version of the same fact (e.g., project status changed, goal revised, preference updated). Use mergedContent if the new content only partially overlaps and you want to combine both into a single coherent entry.
- DELETE when an existing entry is fully redundant given the new content
- Leave alone (omit from operations) when entries are related but both independently valuable (e.g., two different decisions about the same project)
- Set addNew to false only when the new content is fully captured by an UPDATE with mergedContent
- When in doubt, leave existing entries alone — false updates are worse than mild duplication

Return ONLY valid JSON matching this schema:
{
  "operations": [
    {
      "action": "UPDATE" | "DELETE",
      "thoughtId": "<id of existing entry>",
      "reason": "<why this action>",
      "mergedContent": "<optional: combined content for UPDATE>"
    }
  ],
  "addNew": true | false
}`;

export const classifyThought = internalAction({
  args: {
    newContent: v.string(),
    candidates: v.array(
      v.object({
        _id: v.string(),
        content: v.string(),
        metadata: v.object({
          type: v.string(),
          topics: v.array(v.string()),
          people: v.array(v.string()),
          summary: v.string(),
        }),
        createdAt: v.number(),
      }),
    ),
  },
  returns: v.union(classificationResponseSchema, v.null()),
  handler: async (_ctx, args): Promise<ClassificationResponse | null> => {
    const candidateList = args.candidates
      .map(
        (c: CandidateThought) =>
          `ID: ${c._id}\nContent: ${c.content}\nType: ${c.metadata.type}\nTopics: ${c.metadata.topics.join(", ")}\nSummary: ${c.metadata.summary}\nCreated: ${new Date(c.createdAt).toISOString()}`,
      )
      .join("\n\n---\n\n");

    const userMessage = `NEW CONTENT:\n${args.newContent}\n\nEXISTING SIMILAR ENTRIES:\n\n${candidateList}`;

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
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!response.ok) {
        console.error(
          `Classification LLM call failed: ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        content: Array<{ text: string }>;
      };
      const text = data.content[0]!.text;

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("Classification returned no valid JSON:", text);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ClassificationResponse;

      // Validate structure
      if (!Array.isArray(parsed.operations) || typeof parsed.addNew !== "boolean") {
        console.error("Classification returned invalid structure:", parsed);
        return null;
      }

      // Validate thoughtIds against candidate set
      const validIds = new Set(args.candidates.map((c: CandidateThought) => c._id));
      const validatedOps = parsed.operations.filter((op) => {
        if (!validIds.has(op.thoughtId)) {
          console.warn(
            `Classification returned unknown thoughtId: ${op.thoughtId}, ignoring`,
          );
          return false;
        }
        if (op.action !== "UPDATE" && op.action !== "DELETE") {
          console.warn(
            `Classification returned invalid action: ${op.action}, ignoring`,
          );
          return false;
        }
        return true;
      });

      return {
        operations: validatedOps,
        addNew: parsed.addNew,
      };
    } catch (error) {
      console.error("Classification error:", error);
      return null;
    }
  },
});
