"use client";

import { useQuery } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ThoughtCard } from "@/features/thoughts/components/ThoughtCard";

const TYPES = [
  "decision",
  "person_note",
  "idea",
  "meeting_note",
  "task",
  "reference",
] as const;

type ThoughtType = (typeof TYPES)[number];

export default function BrowsePage() {
  const [typeFilter, setTypeFilter] = useState<ThoughtType | "">("");

  const thoughts = useQuery(
    api.models.thoughts.public.listRecent,
    typeFilter
      ? { limit: 50, type: typeFilter }
      : { limit: 50 },
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Browse</h1>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ThoughtType | "")}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {thoughts === undefined ? (
        <p>Loading...</p>
      ) : thoughts.length === 0 ? (
        <p style={{ color: "#666" }}>No thoughts found.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {thoughts.map((thought: { _id: string; _creationTime: number; content: string; metadata: { type: string; topics: string[]; people: string[]; actionItems: string[]; summary: string }; userId: string }) => (
            <ThoughtCard key={thought._id} thought={thought} />
          ))}
        </div>
      )}
    </div>
  );
}
