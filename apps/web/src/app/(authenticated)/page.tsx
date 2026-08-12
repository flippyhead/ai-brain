"use client";

import { api } from "@repo/db/convex/_generated/api";
import { useQuery } from "convex/react";

import { QuickCapture } from "@/features/thoughts/components/QuickCapture";
import { ThoughtCard } from "@/features/thoughts/components/ThoughtCard";

export default function DashboardPage() {
  const stats = useQuery(api.models.thoughts.public.getStats);
  const recent = useQuery(api.models.thoughts.public.listRecent, {
    limit: 10,
  });

  return (
    <div>
      <h1>Dashboard</h1>

      {stats && (
        <div
          style={{
            display: "flex",
            gap: 24,
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: 16,
              border: "1px solid #eee",
              borderRadius: 8,
              minWidth: 120,
            }}
          >
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              {stats.totalFacts}
            </div>
            <div style={{ color: "#666" }}>facts</div>
          </div>
          <div
            style={{
              padding: 16,
              border: "1px solid #eee",
              borderRadius: 8,
              minWidth: 120,
            }}
          >
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              {stats.totalThoughts}
            </div>
            <div style={{ color: "#666" }}>thoughts</div>
          </div>
          {stats.byType
            .slice(0, 3)
            .map((t: { type: string; count: number }) => (
              <div
                key={t.type}
                style={{
                  padding: 16,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  minWidth: 120,
                }}
              >
                <div style={{ fontSize: 32, fontWeight: "bold" }}>
                  {t.count}
                </div>
                <div style={{ color: "#666" }}>{t.type.replace("_", " ")}</div>
              </div>
            ))}
        </div>
      )}

      <QuickCapture />

      <h2 style={{ marginTop: 32 }}>Recent Thoughts</h2>
      {recent === undefined ? (
        <p>Loading...</p>
      ) : recent.length === 0 ? (
        <p style={{ color: "#666" }}>
          No thoughts yet. Capture your first one above, or connect an AI client
          via MCP.{" "}
          <a href="/getting-started" style={{ color: "#0070f3" }}>
            Check out the Getting Started guide
          </a>{" "}
          to seed your brain.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {recent.map(
            (thought: {
              _id: string;
              _creationTime: number;
              content: string;
              metadata: {
                type: string;
                topics: string[];
                people: string[];
                actionItems: string[];
                summary: string;
              };
              userId: string;
            }) => (
              <ThoughtCard key={thought._id} thought={thought} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
