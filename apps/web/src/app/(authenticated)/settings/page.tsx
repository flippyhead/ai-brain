"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import Link from "next/link";

export default function SettingsPage() {
  const apiKeys = useQuery(api.models.apiKeys.public.list);
  const createKey = useMutation(api.models.apiKeys.public.create);
  const revokeKey = useMutation(api.models.apiKeys.public.revoke);

  const [newKeyName, setNewKeyName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    try {
      const result = await createKey({ name: newKeyName.trim() });
      setNewRawKey(result.rawKey);
      setNewKeyName("");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (newRawKey) {
      await navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasKeys = apiKeys && apiKeys.length > 0;
  const showKeyForm = hasKeys || showCreateForm;

  return (
    <div>
      <h1>Settings</h1>

      <h2>API Keys</h2>
      <p style={{ color: "#666" }}>
        Most clients (Claude Desktop, Claude Code) connect automatically via OAuth
        &mdash; no key needed. API keys are only required for clients like Cursor
        that don&apos;t support OAuth.
        See the <Link href="/getting-started" style={{ color: "#111" }}>Getting Started</Link> guide for setup instructions.
      </p>

      {!showKeyForm && (
        <button
          onClick={() => setShowCreateForm(true)}
          style={{
            padding: "8px 16px",
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #ddd",
            background: "white",
            marginBottom: 24,
          }}
        >
          Generate API Key
        </button>
      )}

      {showKeyForm && (
        <>
          <form
            onSubmit={handleCreate}
            style={{ display: "flex", gap: 8, marginBottom: 24 }}
          >
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder='Key name (e.g., "Cursor")'
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 4,
                border: "1px solid #ddd",
              }}
            />
            <button
              type="submit"
              disabled={creating || !newKeyName.trim()}
              style={{ padding: "8px 16px", cursor: "pointer", borderRadius: 4 }}
            >
              {creating ? "Creating..." : "Generate Key"}
            </button>
          </form>

          {newRawKey && (
            <div
              style={{
                padding: 16,
                marginBottom: 24,
                backgroundColor: "#fff3cd",
                border: "1px solid #ffc107",
                borderRadius: 8,
              }}
            >
              <strong>Save this key now — it won&apos;t be shown again!</strong>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <code
                  style={{
                    flex: 1,
                    padding: 8,
                    backgroundColor: "#f5f5f5",
                    borderRadius: 4,
                    fontSize: 13,
                    wordBreak: "break-all",
                  }}
                >
                  {newRawKey}
                </code>
                <button
                  onClick={handleCopy}
                  style={{ padding: "8px 16px", cursor: "pointer", borderRadius: 4 }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button
                onClick={() => setNewRawKey(null)}
                style={{
                  marginTop: 8,
                  padding: "4px 12px",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: 32,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Key</th>
                <th style={{ padding: 8 }}>Last Used</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {apiKeys === undefined ? (
                <tr>
                  <td colSpan={5} style={{ padding: 8 }}>
                    Loading...
                  </td>
                </tr>
              ) : apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 8, color: "#666" }}>
                    No API keys yet.
                  </td>
                </tr>
              ) : (
                apiKeys.map((key: { _id: any; _creationTime: number; keyPrefix: string; name: string; lastUsedAt?: number }) => (
                  <tr key={key._id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{key.name}</td>
                    <td style={{ padding: 8 }}>
                      <code>{key.keyPrefix}...</code>
                    </td>
                    <td style={{ padding: 8, color: "#666" }}>
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td style={{ padding: 8, color: "#666" }}>
                      {new Date(key._creationTime).toLocaleDateString()}
                    </td>
                    <td style={{ padding: 8 }}>
                      <button
                        onClick={() => revokeKey({ id: key._id })}
                        style={{
                          color: "red",
                          cursor: "pointer",
                          background: "none",
                          border: "none",
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
