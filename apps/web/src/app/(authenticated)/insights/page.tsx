"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { InsightCard } from "@/features/insights/components/InsightCard";

type Tab = "latest" | "unresolved";

export default function InsightsPage() {
  const [tab, setTab] = useState<Tab>("latest");
  const [showClearAll, setShowClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const deleteInsight = useMutation(api.models.reports.public.deleteInsight);

  const latestReport = useQuery(api.models.reports.public.getLatestReport, {});
  const reportInsights = useQuery(
    api.models.reports.public.listInsightsByReport,
    latestReport ? { reportId: latestReport._id } : "skip",
  );
  const unresolvedInsights = useQuery(
    api.models.reports.public.listUnresolvedInsights,
    {},
  );
  const allReports = useQuery(api.models.reports.public.listReports, {});
  const allInsights = useQuery(api.models.reports.public.listAllInsights, {});

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div>
      {/* Tabs + Clear All */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: showClearAll ? 0 : 24,
          borderBottom: "1px solid #eee",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setTab("latest")}
          style={{
            padding: "8px 20px",
            border: "none",
            borderBottom: tab === "latest" ? "2px solid #333" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: tab === "latest" ? 600 : 400,
            fontSize: 15,
          }}
        >
          Latest Report
        </button>
        <button
          onClick={() => setTab("unresolved")}
          style={{
            padding: "8px 20px",
            border: "none",
            borderBottom: tab === "unresolved" ? "2px solid #333" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: tab === "unresolved" ? 600 : 400,
            fontSize: 15,
          }}
        >
          Unresolved
          {unresolvedInsights && unresolvedInsights.length > 0 && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 10,
                backgroundColor: "#e3f2fd",
                fontSize: 12,
              }}
            >
              {unresolvedInsights.length}
            </span>
          )}
        </button>
        {allInsights && allInsights.length > 0 && (
          <button
            onClick={() => setShowClearAll(!showClearAll)}
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: showClearAll ? "#ffebee" : "#fff",
              color: "#d32f2f",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Clear All ({allInsights.length})
          </button>
        )}
      </div>

      {/* Clear All confirmation */}
      {showClearAll && allInsights && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            marginBottom: 24,
            backgroundColor: "#ffebee",
            borderRadius: "0 0 4px 4px",
            border: "1px solid #ef5350",
            borderTop: "none",
          }}
        >
          <span style={{ fontSize: 13, color: "#c62828" }}>
            Permanently delete all {allInsights.length} insights (all statuses)?
          </span>
          <button
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              for (const insight of allInsights) {
                await deleteInsight({ insightId: insight._id });
              }
              setClearing(false);
              setShowClearAll(false);
            }}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "none",
              background: "#d32f2f",
              color: "#fff",
              cursor: clearing ? "wait" : "pointer",
              fontSize: 13,
            }}
          >
            {clearing ? "Deleting..." : "Confirm"}
          </button>
          <button
            onClick={() => setShowClearAll(false)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Latest Report Tab */}
      {tab === "latest" && (
        <div>
          {latestReport === undefined ? (
            <p>Loading...</p>
          ) : latestReport === null ? (
            <p style={{ color: "#666" }}>
              No reports yet. Run <code>/workflow-analyst</code> in Claude Code to generate your first report.
            </p>
          ) : (
            <>
              {/* Summary strip */}
              <div
                style={{
                  padding: 12,
                  backgroundColor: "#fafafa",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 14,
                  color: "#555",
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <strong>Period:</strong> {formatDate(latestReport.startDate)} — {formatDate(latestReport.endDate)}
                </span>
                <span>
                  <strong>Sessions:</strong> {latestReport.sessionsAnalyzed}
                </span>
                <span>
                  <strong>Prompts:</strong> {latestReport.totalPrompts}
                </span>
                <span>
                  <strong>Tool calls:</strong> {latestReport.totalToolCalls}
                </span>
                <span>
                  <strong>Projects:</strong> {latestReport.projectsActive.length}
                </span>
              </div>

              {/* Insights */}
              {reportInsights === undefined ? (
                <p>Loading insights...</p>
              ) : reportInsights.length === 0 ? (
                <p style={{ color: "#666" }}>No insights in this report.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {reportInsights.map((insight) => (
                    <InsightCard key={insight._id} insight={insight} />
                  ))}
                </div>
              )}

              {/* Report history link */}
              {allReports && allReports.length > 1 && (
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #eee" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Previous Reports</h3>
                  {allReports.slice(1).map((report) => (
                    <div
                      key={report._id}
                      style={{
                        padding: 8,
                        fontSize: 14,
                        color: "#555",
                        borderBottom: "1px solid #f5f5f5",
                      }}
                    >
                      {formatDate(report.startDate)} — {formatDate(report.endDate)}
                      {" · "}
                      {report.sessionsAnalyzed} sessions
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Unresolved Tab */}
      {tab === "unresolved" && (
        <div>
          {unresolvedInsights === undefined ? (
            <p>Loading...</p>
          ) : unresolvedInsights.length === 0 ? (
            <p style={{ color: "#666" }}>All caught up! No unresolved insights.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {unresolvedInsights.map((insight) => (
                <InsightCard key={insight._id} insight={insight} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
