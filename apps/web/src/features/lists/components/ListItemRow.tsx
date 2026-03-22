"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useRef, useState } from "react";
import { Id } from "@repo/db/convex/_generated/dataModel";

interface ListItemRowProps {
  item: {
    _id: Id<"listItems">;
    title: string;
    status: "open" | "done";
    url?: string;
    description?: string;
  };
}

export function ListItemRow({ item }: ListItemRowProps) {
  const updateItem = useMutation(api.models.lists.public.updateListItem);
  const deleteItem = useMutation(api.models.lists.public.deleteListItem);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [loading, setLoading] = useState(false);
  const savingTitle = useRef(false);
  const cancelEdit = useRef(false);

  const isDone = item.status === "done";

  const toggleStatus = async () => {
    setLoading(true);
    try {
      await updateItem({
        itemId: item._id,
        status: isDone ? "open" : "done",
      });
    } catch (err) {
      console.error("Failed to update item:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveTitle = async () => {
    if (savingTitle.current) return;
    savingTitle.current = true;
    const trimmed = editTitle.trim();
    try {
      if (trimmed && trimmed !== item.title) {
        await updateItem({ itemId: item._id, title: trimmed });
      } else {
        setEditTitle(item.title);
      }
    } catch (err) {
      console.error("Failed to update title:", err);
    } finally {
      setEditing(false);
      savingTitle.current = false;
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem({ itemId: item._id });
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid #f8f8f8",
      }}
    >
      <input
        type="checkbox"
        checked={isDone}
        disabled={loading}
        onChange={toggleStatus}
        style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer", marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (cancelEdit.current) {
                cancelEdit.current = false;
                return;
              }
              saveTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") {
                cancelEdit.current = true;
                setEditTitle(item.title);
                setEditing(false);
              }
            }}
            autoFocus
            style={{
              width: "100%",
              fontSize: 14,
              padding: "2px 4px",
              border: "1px solid #0070f3",
              borderRadius: 4,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onClick={() => {
              if (!isDone) {
                cancelEdit.current = false;
                setEditTitle(item.title);
                setEditing(true);
              }
            }}
            style={{
              fontSize: 14,
              color: isDone ? "#999" : "#333",
              textDecoration: isDone ? "line-through" : "none",
              cursor: isDone ? "default" : "text",
            }}
          >
            {item.title}
          </span>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "block",
              fontSize: 12,
              color: "#0070f3",
              textDecoration: "none",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.url}
          </a>
        )}
        {item.description && (
          <p
            style={{
              fontSize: 12,
              color: "#666",
              margin: "2px 0 0",
              lineHeight: 1.4,
            }}
          >
            {item.description}
          </p>
        )}
      </div>
      {isDone && (
        <span
          onClick={handleDelete}
          style={{
            fontSize: 11,
            color: "#999",
            cursor: "pointer",
            padding: "2px 4px",
          }}
          title="Remove item"
        >
          ✕
        </span>
      )}
    </div>
  );
}
