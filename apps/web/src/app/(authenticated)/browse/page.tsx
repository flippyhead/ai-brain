"use client";

import { api } from "@repo/db/convex/_generated/api";
import { Id } from "@repo/db/convex/_generated/dataModel";
import { useMutation,useQuery } from "convex/react";
import { useState } from "react";

import { CreateListInput } from "@/features/lists/components/CreateListInput";
import { ListCard } from "@/features/lists/components/ListCard";
import { ThoughtsView } from "@/features/thoughts/components/ThoughtsView";

type View = "lists" | "facts" | "thoughts";

export default function BrowsePage() {
  const [view, setView] = useState<View>("lists");
  const [showCreateList, setShowCreateList] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showHistoricalFacts, setShowHistoricalFacts] = useState(false);

  const lists = useQuery(
    api.models.lists.public.getLists,
    view === "lists" ? { includeArchived: showArchived } : "skip",
  );

  const unarchiveList = useMutation(api.models.lists.public.unarchiveList);
  const facts = useQuery(
    api.models.facts.public.listRecent,
    view === "facts"
      ? { limit: 50, includeHistorical: showHistoricalFacts }
      : "skip",
  );

  const activeLists = lists?.filter((l) => !l.archivedAt) ?? [];
  const archivedLists = lists?.filter((l) => l.archivedAt) ?? [];
  const pinnedLists = activeLists.filter((l) => l.pinned);
  const otherLists = activeLists.filter((l) => !l.pinned);

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
            onClick={() => setView("facts")}
            style={{
              padding: "6px 16px",
              background: view === "facts" ? "#333" : "transparent",
              color: view === "facts" ? "#fff" : "#666",
              cursor: "pointer",
            }}
          >
            Facts
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
          ) : (
            <>
              {lists.length === 0 && !showCreateList ? (
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

              {/* Archived section */}
              <div style={{ marginTop: 24 }}>
                <span
                  onClick={() => setShowArchived(!showArchived)}
                  style={{
                    fontSize: 12,
                    color: "#0070f3",
                    cursor: "pointer",
                  }}
                >
                  {showArchived ? "Hide archived" : "Show archived lists"}
                </span>
              </div>

              {showArchived && archivedLists.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#999",
                      marginBottom: 8,
                      marginTop: 12,
                    }}
                  >
                    Archived
                  </div>
                  {archivedLists.map((list) => (
                    <div
                      key={list._id}
                      style={{
                        border: "1px solid #e0e0e0",
                        borderRadius: 8,
                        marginBottom: 8,
                        backgroundColor: "#fafafa",
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 500,
                            fontSize: 15,
                            color: "#999",
                          }}
                        >
                          {list.name}
                        </span>
                        <span style={{ color: "#999", fontSize: 12 }}>
                          {list.counts.total} items
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          unarchiveList({ listId: list._id as Id<"lists"> })
                        }
                        style={{
                          padding: "4px 12px",
                          background: "none",
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          fontSize: 12,
                          cursor: "pointer",
                          color: "#666",
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      ) : view === "facts" ? (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <p style={{ color: "#666", margin: 0 }}>
              Precise attributes and relationships. Changed values remain
              available as history.
            </p>
            <label style={{ fontSize: 13, color: "#666" }}>
              <input
                type="checkbox"
                checked={showHistoricalFacts}
                onChange={(event) =>
                  setShowHistoricalFacts(event.target.checked)
                }
                style={{ marginRight: 6 }}
              />
              Show history
            </label>
          </div>
          {facts === undefined ? (
            <p style={{ color: "#666" }}>Loading...</p>
          ) : facts.length === 0 ? (
            <p style={{ color: "#666" }}>
              No structured facts yet. AI clients can add exact dates,
              relationships, providers, schools, and other durable attributes.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {facts.map((fact) => (
                <div
                  key={fact.id}
                  style={{
                    border: "1px solid #e0e0e0",
                    borderRadius: 8,
                    padding: "14px 16px",
                    background: fact.status === "current" ? "#fff" : "#fafafa",
                    opacity: fact.status === "current" ? 1 : 0.72,
                  }}
                >
                  <div style={{ fontSize: 16 }}>{fact.statement}</div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 8,
                      fontSize: 12,
                      color: "#666",
                    }}
                  >
                    <span>{fact.subject?.key ?? "unknown subject"}</span>
                    <span>·</span>
                    <span>{fact.predicate}</span>
                    <span>·</span>
                    <span>{fact.status}</span>
                    {fact.isCore && (
                      <>
                        <span>·</span>
                        <span>core</span>
                      </>
                    )}
                    {fact.validFrom !== undefined && (
                      <>
                        <span>·</span>
                        <span>
                          from {new Date(fact.validFrom).toLocaleDateString()}
                        </span>
                      </>
                    )}
                    {fact.validTo !== undefined && (
                      <>
                        <span>·</span>
                        <span>
                          until {new Date(fact.validTo).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ThoughtsView />
      )}
    </div>
  );
}
