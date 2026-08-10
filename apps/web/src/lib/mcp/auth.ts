import { api } from "@repo/db/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

export async function authenticateApiKey(
  authHeader: string | null,
): Promise<{ userId: string; keyId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice(7);

  // Hash the key
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const convex = getConvex();
  const result = await convex.action(
    api.models.apiKeys.mcpAuth.authenticateKeyHash,
    { keyHash },
  );
  if (!result) return null;

  return { userId: result.userId, keyId: result.keyId };
}
