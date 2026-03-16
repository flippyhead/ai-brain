"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";

function Nav() {
  const { signOut } = useAuthActions();

  return (
    <nav
      style={{
        display: "flex",
        gap: 16,
        padding: "12px 24px",
        borderBottom: "1px solid #eee",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <strong>Open Brain</strong>
      <Link href="/">Dashboard</Link>
      <Link href="/browse">Browse</Link>
      <Link href="/insights">Insights</Link>
      <Link href="/settings">Settings</Link>
      <Link href="/getting-started">Getting Started</Link>
      <div style={{ marginLeft: "auto" }}>
        <button onClick={() => signOut()} style={{ cursor: "pointer" }}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AuthLoading>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: 48,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading...
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: 48,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Redirecting to sign in...
        </div>
      </Unauthenticated>
      <Authenticated>
        <Nav />
        <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          {children}
        </main>
      </Authenticated>
    </>
  );
}
