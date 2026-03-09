import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";

export async function _findReportById(ctx: QueryCtx, id: Id<"reports">) {
  return await ctx.db.get(id);
}

export async function _listReportsByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
) {
  return await ctx.db
    .query("reports")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function _insertReport(
  ctx: MutationCtx,
  fields: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    sessionsAnalyzed: number;
    totalPrompts: number;
    totalToolCalls: number;
    projectsActive: { path: string; sessions: number }[];
    modelUsage: unknown;
  },
) {
  return await ctx.db.insert("reports", fields);
}

export async function _findInsightById(ctx: QueryCtx, id: Id<"insights">) {
  return await ctx.db.get(id);
}

export async function _listInsightsByReport(
  ctx: QueryCtx,
  reportId: Id<"reports">,
) {
  return await ctx.db
    .query("insights")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .collect();
}

export async function _listInsightsByUserAndStatus(
  ctx: QueryCtx,
  userId: Id<"users">,
  status: "new" | "noted" | "done" | "dismissed",
  limit: number = 50,
  category?:
    | "feature-discovery"
    | "anti-pattern"
    | "productivity"
    | "automation",
) {
  let query = ctx.db
    .query("insights")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", status),
    );

  if (category) {
    query = query.filter((q) => q.eq(q.field("category"), category));
  }

  return await query.order("desc").take(limit);
}

export async function _insertInsight(
  ctx: MutationCtx,
  fields: {
    reportId: Id<"reports">;
    userId: Id<"users">;
    category:
      | "feature-discovery"
      | "anti-pattern"
      | "productivity"
      | "automation";
    observation: string;
    recommendation: string;
    evidence: string;
    links?: { label: string; url: string }[];
    status: "new" | "noted" | "done" | "dismissed";
    dismissTag?: "already-fixed" | "not-relevant" | "already-knew" | "incorrect";
    dismissText?: string;
    updatedAt?: number;
  },
) {
  return await ctx.db.insert("insights", fields);
}

export async function _updateInsightStatus(
  ctx: MutationCtx,
  insight: Doc<"insights">,
  fields: {
    status: "new" | "noted" | "done" | "dismissed";
    dismissTag?: "already-fixed" | "not-relevant" | "already-knew" | "incorrect";
    dismissText?: string;
    updatedAt?: number;
  },
) {
  const { _id, _creationTime, ...rest } = insight;
  const next = {
    ...rest,
    status: fields.status,
    updatedAt: fields.updatedAt,
  };

  if (fields.status === "dismissed") {
    if (fields.dismissTag) {
      next.dismissTag = fields.dismissTag;
    } else {
      delete next.dismissTag;
    }
    if (fields.dismissText) {
      next.dismissText = fields.dismissText;
    } else {
      delete next.dismissText;
    }
  } else {
    delete next.dismissTag;
    delete next.dismissText;
  }

  return await ctx.db.replace(_id, next);
}
