import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { thoughtFields } from "./models/thoughts/validators";
import { apiKeyFields } from "./models/apiKeys/validators";

export default defineSchema({
  ...authTables,
  thoughts: defineTable(thoughtFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_type", ["userId", "metadata.type"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),
  apiKeys: defineTable(apiKeyFields)
    .index("by_keyHash", ["keyHash"])
    .index("by_userId", ["userId"]),
});
