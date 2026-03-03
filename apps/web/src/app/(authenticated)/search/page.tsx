"use client";

import { useAction } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ThoughtCard } from "@/features/thoughts/components/ThoughtCard";

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

export default function SearchPage() {
  const searchThoughts = useAction(api.models.thoughts.publicActions.search);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await searchThoughts({ query: query.trim() });
      setResults(res as unknown as SearchResult[]);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Search</h1>
      <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
            disabled={loading || !query.trim()}
            style={{ padding: "10px 20px", cursor: "pointer", borderRadius: 4 }}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {results === null ? (
        <p style={{ color: "#666" }}>
          Enter a query to search your thoughts by meaning.
        </p>
      ) : results.length === 0 ? (
        <p style={{ color: "#666" }}>No matching thoughts found.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {results.map((r) => (
            <ThoughtCard
              key={r._id}
              thought={{
                ...r,
                _creationTime: r.createdAt,
              }}
              score={r.score}
            />
          ))}
        </div>
      )}
    </div>
  );
}
