"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useRef, useState } from "react";
import { Id } from "@repo/db/convex/_generated/dataModel";
import { ListItemRow } from "./ListItemRow";

interface ListCardProps {
  list: {
    _id: Id<"lists">;
    name: string;
    pinned: boolean;
    counts: { total: number; open: number; done: number };
  };
  defaultExpanded?: boolean;
}

export function ListCard({ list, defaultExpanded = false }: ListCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showCompleted, setShowCompleted] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(list.name);
  const [newItemTitle, setNewItemTitle] = useState("");
  const renamingInFlight = useRef(false);
  const cancelRename = useRef(false);
  const addingItemInFlight = useRef(false);

  const updateList = useMutation(api.models.lists.public.updateList);
  const archiveList = useMutation(api.models.lists.public.archiveList);
  const createItem = useMutation(api.models.lists.public.createListItem);

  const listDetail = useQuery(
    api.models.lists.public.getList,
    expanded ? { listId: list._id, includeCompleted: showCompleted } : "skip",
  );

  const handleRename = async () => {
    if (renamingInFlight.current) return;
    renamingInFlight.current = true;
    const trimmed = renameName.trim();
    try {
      if (trimmed && trimmed !== list.name) {
        await updateList({ listId: list._id, name: trimmed });
      } else {
        setRenameName(list.name);
      }
    } catch (err) {
      console.error("Failed to rename:", err);
    } finally {
      setRenaming(false);
      renamingInFlight.current = false;
    }
  };

  const handleTogglePin = async () => {
    try {
      await updateList({ listId: list._id, pinned: !list.pinned });
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleArchive = async () => {
    try {
      await archiveList({ listId: list._id });
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleAddItem = async () => {
    if (addingItemInFlight.current) return;
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    addingItemInFlight.current = true;
    setNewItemTitle("");
    try {
      await createItem({ listId: list._id, title: trimmed });
    } catch (err) {
      console.error("Failed to add item:", err);
    } finally {
      addingItemInFlight.current = false;
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        marginBottom: 8,
        backgroundColor: "#fff",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: expanded ? "1px solid #f0f0f0" : "none",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#999", fontSize: 12 }}>
            {expanded ? "▼" : "▶"}
          </span>
          {renaming ? (
            <input
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={() => {
                if (cancelRename.current) {
                  cancelRename.current = false;
                  return;
                }
                handleRename();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  cancelRename.current = true;
                  setRenameName(list.name);
                  setRenaming(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                fontWeight: 600,
                fontSize: 15,
                border: "1px solid #0070f3",
                borderRadius: 4,
                padding: "2px 6px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <span style={{ fontWeight: 600, fontSize: 15 }}>{list.name}</span>
          )}
          {list.pinned && (
            <span
              style={{
                background: "#e8f4e8",
                color: "#16a34a",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              pinned
            </span>
          )}
          <span style={{ color: "#999", fontSize: 12 }}>
            {list.counts.open}/{list.counts.total} open
          </span>
        </div>
        <div
          style={{ display: "flex", gap: 8, fontSize: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            onClick={() => {
              cancelRename.current = false;
              setRenameName(list.name);
              setRenaming(true);
            }}
            style={{ cursor: "pointer" }}
            title="Rename"
          >
            ✏️
          </span>
          <span
            onClick={handleTogglePin}
            style={{ cursor: "pointer" }}
            title={list.pinned ? "Unpin" : "Pin"}
          >
            📌
          </span>
          <span
            onClick={handleArchive}
            style={{ cursor: "pointer" }}
            title="Archive"
          >
            📦
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "8px 16px" }}>
          {listDetail === undefined ? (
            <p style={{ color: "#999", fontSize: 14, margin: "8px 0" }}>
              Loading...
            </p>
          ) : listDetail.items.length === 0 && list.counts.done === 0 ? (
            <p style={{ color: "#999", fontSize: 14, margin: "8px 0" }}>
              No items yet.
            </p>
          ) : listDetail.items.length === 0 ? (
            null
          ) : (
            listDetail.items.map((item) => (
              <ListItemRow key={item._id} item={item} />
            ))
          )}

          {/* Show completed toggle */}
          {list.counts.done > 0 && (
            <div style={{ marginTop: 4 }}>
              <span
                onClick={() => setShowCompleted(!showCompleted)}
                style={{
                  fontSize: 12,
                  color: "#0070f3",
                  cursor: "pointer",
                }}
              >
                {showCompleted
                  ? "Hide completed"
                  : `Show ${list.counts.done} completed`}
              </span>
            </div>
          )}

          {/* Add item input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              marginTop: 4,
            }}
          >
            <span style={{ color: "#ccc", fontSize: 14 }}>+</span>
            <input
              type="text"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
              }}
              placeholder="Add item..."
              style={{
                border: "none",
                outline: "none",
                fontSize: 14,
                color: "#666",
                flex: 1,
                background: "transparent",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
