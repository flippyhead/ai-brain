import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { thoughtFields } from "./models/thoughts/validators";
import { apiKeyFields } from "./models/apiKeys/validators";
import { reportFields, insightFields } from "./models/reports/validators";
import { listFields, listItemFields } from "./models/lists/validators";
import { consumedOAuthCodeFields } from "./models/oauth/validators";
import { entityFields, factFields } from "./models/facts/validators";

export default defineSchema({
  ...authTables,
  thoughts: defineTable(thoughtFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_isCore", ["userId", "isCore"])
    .index("by_userId_and_type", ["userId", "metadata.type"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    })
    .searchIndex("by_content", {
      searchField: "content",
      filterFields: ["userId", "metadata.type"],
    }),
  entities: defineTable(entityFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_userId_kind_normalizedName", [
      "userId",
      "kind",
      "normalizedName",
    ]),
  facts: defineTable(factFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_subject_predicate_status", [
      "userId",
      "subjectEntityId",
      "predicate",
      "status",
    ])
    .index("by_userId_and_isCore", ["userId", "isCore"])
    .index("by_userId_isCore_status", ["userId", "isCore", "status"])
    .searchIndex("by_searchText", {
      searchField: "searchText",
      filterFields: ["userId", "status"],
    }),
  apiKeys: defineTable(apiKeyFields)
    .index("by_keyHash", ["keyHash"])
    .index("by_userId", ["userId"]),
  consumedOAuthCodes: defineTable(consumedOAuthCodeFields)
    .index("by_codeHash", ["codeHash"])
    .index("by_expiresAt", ["expiresAt"]),
  reports: defineTable(reportFields).index("by_userId", ["userId"]),
  insights: defineTable(insightFields)
    .index("by_reportId", ["reportId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),
  lists: defineTable(listFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_pinned", ["userId", "pinned"]),
  listItems: defineTable(listItemFields)
    .index("by_listId", ["listId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),
});
