"use client";

import { useQuery } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ListCard } from "@/features/lists/components/ListCard";
import { CreateListInput } from "@/features/lists/components/CreateListInput";
import { ThoughtsView } from "@/features/thoughts/components/ThoughtsView";

type View = "lists" | "thoughts";

export default function BrowsePage() {
  const [view, setView] = useState<View>("lists");
  const [showCreateList, setShowCreateList] = useState(false);

  const lists = useQuery(
    api.models.lists.public.getLists,
    view === "lists" ? {} : "skip",
  );

  const pinnedLists = lists?.filter((l) => l.pinned) ?? [];
  const otherLists = lists?.filter((l) => !l.pinned) ?? [];

  return (
    <div>
      {/* Header with toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Browse</h1>
        <div
          style={{
            display: "flex",
            background: "#f0f0f0",
            borderRadius: 6,
            overflow: "hidden",
            fontSize: 14,
          }}
        >
          <div
            onClick={() => setView("lists")}
            style={{
              padding: "6px 16px",
              background: view === "lists" ? "#333" : "transparent",
              color: view === "lists" ? "#fff" : "#666",
              cursor: "pointer",
            }}
          >
            Lists
          </div>
          <div
            onClick={() => setView("thoughts")}
            style={{
              padding: "6px 16px",
              background: view === "thoughts" ? "#333" : "transparent",
              color: view === "thoughts" ? "#fff" : "#666",
              cursor: "pointer",
            }}
          >
            Thoughts
          </div>
        </div>
      </div>

      {view === "lists" ? (
        <div>
          {/* New List button */}
          {!showCreateList && (
            <button
              onClick={() => setShowCreateList(true)}
              style={{
                padding: "8px 16px",
                background: "#0070f3",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                cursor: "pointer",
                marginBottom: 24,
              }}
            >
              + New List
            </button>
          )}

          {showCreateList && (
            <CreateListInput onDone={() => setShowCreateList(false)} />
          )}

          {lists === undefined ? (
            <p style={{ color: "#666" }}>Loading...</p>
          ) : lists.length === 0 && !showCreateList ? (
            <p style={{ color: "#666" }}>
              No lists yet. Create one to start tracking goals and todos.
            </p>
          ) : (
            <>
              {/* Pinned section */}
              {pinnedLists.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#999",
                      marginBottom: 8,
                    }}
                  >
                    Pinned
                  </div>
                  {pinnedLists.map((list) => (
                    <ListCard
                      key={list._id}
                      list={list}
                      defaultExpanded={true}
                    />
                  ))}
                  <div style={{ marginBottom: 16 }} />
                </>
              )}

              {/* Other lists section */}
              {otherLists.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#999",
                      marginBottom: 8,
                    }}
                  >
                    Other Lists
                  </div>
                  {otherLists.map((list) => (
                    <ListCard key={list._id} list={list} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <ThoughtsView />
      )}
    </div>
  );
}
