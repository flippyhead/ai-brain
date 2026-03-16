"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";

interface CreateListInputProps {
  onDone: () => void;
}

export function CreateListInput({ onDone }: CreateListInputProps) {
  const createList = useMutation(api.models.lists.public.createList);
  const [name, setName] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      await createList({ name: trimmed, pinned });
      setName("");
      setPinned(false);
      onDone();
    } catch (err) {
      console.error("Failed to create list:", err);
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
        marginBottom: 12,
        backgroundColor: "#fff",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") onDone();
        }}
        placeholder="List name..."
        autoFocus
        style={{
          flex: 1,
          padding: 8,
          border: "1px solid #ddd",
          borderRadius: 4,
          fontSize: 14,
          fontFamily: "inherit",
        }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#666" }}>
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
        />
        Pin
      </label>
      <button
        onClick={handleCreate}
        disabled={loading || !name.trim()}
        style={{
          padding: "8px 16px",
          background: "#0070f3",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          cursor: loading || !name.trim() ? "default" : "pointer",
          opacity: loading || !name.trim() ? 0.5 : 1,
        }}
      >
        {loading ? "..." : "Create"}
      </button>
      <button
        onClick={onDone}
        style={{
          padding: "8px 12px",
          background: "none",
          border: "1px solid #ddd",
          borderRadius: 6,
          fontSize: 14,
          cursor: "pointer",
          color: "#666",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
