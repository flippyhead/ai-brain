"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@repo/db/convex/_generated/dataModel";

const categoryColors: Record<string, string> = {
  "anti-pattern": "#ffebee",
  "feature-discovery": "#e3f2fd",
  productivity: "#e8f5e9",
  automation: "#f3e5f5",
  ecosystem: "#e0f2f1",
};

const categoryTextColors: Record<string, string> = {
  "anti-pattern": "#c62828",
  "feature-discovery": "#1565c0",
  productivity: "#2e7d32",
  automation: "#6a1b9a",
  ecosystem: "#00695c",
};

const DISMISS_TAGS = [
  { value: "already-fixed", label: "Already fixed" },
  { value: "not-relevant", label: "Not relevant" },
  { value: "already-knew", label: "Already knew" },
  { value: "incorrect", label: "Incorrect" },
] as const;

interface InsightCardProps {
  insight: {
    _id: Id<"insights">;
    _creationTime: number;
    category: string;
    observation: string;
    recommendation: string;
    evidence: string;
    links?: { label: string; url: string }[];
    status: string;
    dismissTag?: string;
    dismissText?: string;
  };
}

export function InsightCard({ insight }: InsightCardProps) {
  const updateStatus = useMutation(api.models.reports.public.updateInsightStatus);
  const deleteInsightMutation = useMutation(api.models.reports.public.deleteInsight);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [dismissText, setDismissText] = useState("");
  const [saved, setSaved] = useState(false);

  const isResolved = insight.status === "done" || insight.status === "dismissed";

  const resetDismissForm = () => {
    setSelectedTag("");
    setDismissText("");
  };

  const handleStatus = async (status: "noted" | "done") => {
    setShowDismiss(false);
    resetDismissForm();
    await updateStatus({ insightId: insight._id, status });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleDismiss = async () => {
    if (!selectedTag) return;
    await updateStatus({
      insightId: insight._id,
      status: "dismissed",
      dismissTag: selectedTag as "already-fixed" | "not-relevant" | "already-knew" | "incorrect",
      dismissText: dismissText || undefined,
    });
    resetDismissForm();
    setShowDismiss(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleUndo = async () => {
    await updateStatus({ insightId: insight._id, status: "noted" });
    resetDismissForm();
  };

  const handleDelete = async () => {
    await deleteInsightMutation({ insightId: insight._id });
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fff",
        opacity: isResolved ? 0.6 : 1,
      }}
    >
      {/* Header: category badge + status label */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          alignItems: "center",
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 12,
            backgroundColor: categoryColors[insight.category] ?? "#f5f5f5",
            color: categoryTextColors[insight.category] ?? "#333",
            fontWeight: 500,
          }}
        >
          {insight.category}
        </span>
        {isResolved && (
          <span style={{ fontSize: 12, color: "#999" }}>
            {insight.status}
            {insight.dismissTag && ` — ${insight.dismissTag.replaceAll("-", " ")}`}
          </span>
        )}
        {saved && (
          <span style={{ fontSize: 12, color: "#4caf50" }}>Saved</span>
        )}
      </div>

      {/* Observation */}
      <p style={{ margin: "0 0 8px", fontWeight: 500, lineHeight: 1.4 }}>
        {insight.observation}
      </p>

      {/* Recommendation */}
      <p style={{ margin: "0 0 8px", lineHeight: 1.5, color: "#333" }}>
        {insight.recommendation}
      </p>

      {/* Links */}
      {insight.links && insight.links.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          {insight.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid #ddd",
                backgroundColor: "#f8f9fa",
                color: "#1565c0",
                fontSize: 12,
                textDecoration: "none",
                lineHeight: 1.4,
              }}
            >
              {link.label}
              <span style={{ fontSize: 10 }}>&#x2197;</span>
            </a>
          ))}
        </div>
      )}

      {/* Evidence (collapsible) */}
      <button
        onClick={() => setShowEvidence(!showEvidence)}
        style={{
          background: "none",
          border: "none",
          color: "#666",
          cursor: "pointer",
          fontSize: 13,
          padding: 0,
          marginBottom: showEvidence ? 8 : 0,
        }}
      >
        {showEvidence ? "Hide evidence" : "Show evidence"}
      </button>
      {showEvidence && (
        <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.4 }}>
          {insight.evidence}
        </p>
      )}

      {/* Status controls */}
      {!isResolved && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            onClick={() => handleStatus("noted")}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: insight.status === "noted" ? "#e3f2fd" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Noted
          </button>
          <button
            onClick={() => handleStatus("done")}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Done
          </button>
          <button
            onClick={() => setShowDismiss(!showDismiss)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: showDismiss ? "#ffebee" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: showDeleteConfirm ? "#ffebee" : "#fff",
              cursor: "pointer",
              fontSize: 13,
              color: "#d32f2f",
              marginLeft: "auto",
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Undo for resolved insights */}
      {isResolved && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={handleUndo}
            style={{
              background: "none",
              border: "none",
              color: "#1565c0",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: "#ffebee",
            borderRadius: 4,
            border: "1px solid #ef5350",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#c62828" }}>
            Delete this insight permanently?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleDelete}
              style={{
                padding: "6px 16px",
                borderRadius: 4,
                border: "none",
                background: "#d32f2f",
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Delete
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={{
                padding: "6px 16px",
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
        </div>
      )}

      {/* Dismiss panel */}
      {showDismiss && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: "#fafafa",
            borderRadius: 4,
            border: "1px solid #eee",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {DISMISS_TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => setSelectedTag(tag.value)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 16,
                  border: selectedTag === tag.value ? "2px solid #c62828" : "1px solid #ddd",
                  background: selectedTag === tag.value ? "#ffebee" : "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={dismissText}
            onChange={(e) => setDismissText(e.target.value)}
            placeholder="Why? (optional, saved to your brain)"
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ddd",
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleDismiss}
            disabled={!selectedTag}
            style={{
              padding: "6px 16px",
              borderRadius: 4,
              border: "none",
              background: selectedTag ? "#c62828" : "#ccc",
              color: "#fff",
              cursor: selectedTag ? "pointer" : "default",
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
