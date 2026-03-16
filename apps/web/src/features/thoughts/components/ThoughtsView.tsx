"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ThoughtCard } from "./ThoughtCard";

const TYPES = [
  "decision",
  "person_note",
  "idea",
  "meeting_note",
  "task",
  "reference",
] as const;

type ThoughtType = (typeof TYPES)[number];

interface SearchResult {
  _id: string;
  content: string;
  metadata: {
    type: string;
    topics: string[];
    people: string[];
    actionItems: string[];
    summary: string;
  };
  score: number;
  createdAt: number;
}

export function ThoughtsView() {
  const [typeFilter, setTypeFilter] = useState<ThoughtType | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const searchThoughts = useAction(api.models.thoughts.publicActions.search);

  const recentThoughts = useQuery(
    api.models.thoughts.public.listRecent,
    typeFilter ? { limit: 50, type: typeFilter } : { limit: 50 },
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setSearching(true);
    try {
      const res = await searchThoughts({ query: searchQuery.trim() });
      setSearchResults(res as unknown as SearchResult[]);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
  };

  const showingSearch = searchResults !== null;
  const thoughts = showingSearch ? searchResults : recentThoughts;

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your thoughts semantically..."
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 4,
              border: "1px solid #ddd",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            style={{
              padding: "10px 20px",
              cursor: searching || !searchQuery.trim() ? "default" : "pointer",
              borderRadius: 4,
            }}
          >
            {searching ? "Searching..." : "Search"}
          </button>
          {showingSearch && (
            <button
              type="button"
              onClick={clearSearch}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                borderRadius: 4,
                background: "none",
                border: "1px solid #ddd",
                color: "#666",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Type filter (only when browsing, not searching) */}
      {!showingSearch && (
        <div style={{ marginBottom: 16 }}>
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
      )}

      {/* Results */}
      {thoughts === undefined || thoughts === null ? (
        <p style={{ color: "#666" }}>Loading...</p>
      ) : thoughts.length === 0 ? (
        <p style={{ color: "#666" }}>
          {showingSearch ? "No matching thoughts found." : "No thoughts found."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {thoughts.map((t: any) => (
            <ThoughtCard
              key={t._id}
              thought={{
                ...t,
                _creationTime: t._creationTime ?? t.createdAt,
              }}
              score={t.score}
            />
          ))}
        </div>
      )}
    </div>
  );
}
