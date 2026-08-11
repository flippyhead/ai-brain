"use client";

import { api } from "@repo/db/convex/_generated/api";
import { useAction } from "convex/react";
import { useState } from "react";

export function QuickCapture() {
  const captureThought = useAction(api.models.thoughts.publicActions.capture);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setLoading(true);
    setStatus("");
    try {
      const result = await captureThought({ content: content.trim() });
      if (result.thoughtId) {
        setStatus(
          `Saved as ${result.metadata.type.replace("_", " ")}: ${result.metadata.summary}`,
        );
        setContent("");
      } else {
        setStatus(
          result.operationSummary ??
            "This was not stored. Try one coherent durable narrative, or use a structured fact.",
        );
      }
    } catch {
      setStatus("Failed to capture thought. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fafafa",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Quick Capture</h3>
      <form onSubmit={handleSubmit}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type a thought, decision, note, or idea..."
          rows={3}
          style={{
            width: "100%",
            padding: 8,
            boxSizing: "border-box",
            borderRadius: 4,
            border: "1px solid #ddd",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <button
            type="submit"
            disabled={loading || !content.trim()}
            style={{
              padding: "8px 16px",
              cursor: loading ? "wait" : "pointer",
              borderRadius: 4,
            }}
          >
            {loading ? "Saving..." : "Capture"}
          </button>
          {status && (
            <span style={{ fontSize: 14, color: "#666" }}>{status}</span>
          )}
        </div>
      </form>
    </div>
  );
}
