"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function AuthorizeFlow() {
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");

  const clientId = searchParams.get("client_id") || "";
  const redirectUri = searchParams.get("redirect_uri") || "";
  const codeChallenge = searchParams.get("code_challenge") || "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") || "";
  const responseType = searchParams.get("response_type") || "";
  const resource = searchParams.get("resource") || "";
  const scope = searchParams.get("scope") || undefined;
  const state = searchParams.get("state") || "";
  let redirectDestination = "";
  try {
    redirectDestination = new URL(redirectUri).host;
  } catch {
    // The server performs the authoritative redirect URI validation.
  }

  if (
    !clientId ||
    !redirectUri ||
    !codeChallenge ||
    codeChallengeMethod !== "S256" ||
    responseType !== "code" ||
    !resource ||
    !redirectDestination ||
    (scope !== undefined && scope !== "open-brain")
  ) {
    return (
      <div style={containerStyle}>
        <h1>Open Brain</h1>
        <p style={{ color: "#dc2626" }}>
          Missing OAuth parameters. Please start the authorization flow from
          your MCP client.
        </p>
      </div>
    );
  }

  async function handleAuthorize() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/authorize/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          redirectUri,
          codeChallenge,
          codeChallengeMethod,
          responseType,
          resource,
          scope,
          state: state || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Authorization failed");
      }
      const response: unknown = await res.json();
      if (
        !response ||
        typeof response !== "object" ||
        !("redirect_url" in response) ||
        typeof response.redirect_url !== "string"
      ) {
        throw new Error("Authorization returned an invalid redirect");
      }

      const redirect = new URL(response.redirect_url);
      const registeredRedirect = new URL(redirectUri);
      if (
        redirect.origin !== registeredRedirect.origin ||
        redirect.pathname !== registeredRedirect.pathname
      ) {
        throw new Error("Authorization returned an invalid redirect");
      }
      window.location.assign(redirect.toString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authorization failed");
      setLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <h1>Open Brain</h1>

      <AuthLoading>
        <p style={{ color: "#666" }}>Loading...</p>
      </AuthLoading>

      <Unauthenticated>
        <p style={{ color: "#666", marginTop: 0 }}>
          {mode === "signIn"
            ? "Sign in to authorize this MCP client."
            : "Create an account to authorize this MCP client."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setLoading(true);
            const formData = new FormData(e.currentTarget);
            try {
              await signIn("password", formData);
            } catch {
              setError(
                mode === "signIn"
                  ? "Invalid email or password"
                  : "Could not create account. Try a different email.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="email"
              style={{ display: "block", marginBottom: 4, fontWeight: 500 }}
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="password"
              style={{ display: "block", marginBottom: 4, fontWeight: 500 }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              {...(mode === "signUp" ? { minLength: 8 } : {})}
              style={inputStyle}
            />
          </div>
          <input type="hidden" name="flow" value={mode} />
          {error && <p style={{ color: "#dc2626" }}>{error}</p>}
          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading
              ? mode === "signIn"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signIn"
                ? "Sign In"
                : "Sign Up"}
          </button>
        </form>
        <p style={{ marginTop: 16, textAlign: "center", color: "#666" }}>
          {mode === "signIn" ? (
            <>
              Don&apos;t have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (loading) {
                    return;
                  }
                  setMode("signUp");
                  setError("");
                }}
                style={{ color: "#0070f3" }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (loading) {
                    return;
                  }
                  setMode("signIn");
                  setError("");
                }}
                style={{ color: "#0070f3" }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </Unauthenticated>

      <Authenticated>
        <p style={{ color: "#666", marginTop: 0 }}>
          An MCP client is requesting permission to read and change your Open
          Brain data. After approval, you will return to{" "}
          <strong>{redirectDestination}</strong>.
        </p>
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}
        <button
          onClick={handleAuthorize}
          disabled={loading}
          style={buttonStyle}
        >
          {loading ? "Authorizing..." : "Authorize"}
        </button>
      </Authenticated>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <div style={containerStyle}>
          <h1>Open Brain</h1>
          <p style={{ color: "#666" }}>Loading...</p>
        </div>
      }
    >
      <AuthorizeFlow />
    </Suspense>
  );
}

const containerStyle: React.CSSProperties = {
  maxWidth: 420,
  margin: "80px auto",
  padding: "0 20px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#111",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  boxSizing: "border-box",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: "0.95rem",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: 10,
  background: "#111",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: "1rem",
  fontWeight: 500,
};
