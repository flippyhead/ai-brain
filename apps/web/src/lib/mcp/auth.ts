import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/db/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

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

  const result = await convex.query(
    api.models.apiKeys.mcpAuth.validateKeyHash,
    { keyHash },
  );
  if (!result) return null;

  // Update last used (fire and forget)
  convex
    .mutation(api.models.apiKeys.mcpAuth.touchKey, { keyId: result.keyId })
    .catch(() => {});

  return { userId: result.userId, keyId: result.keyId };
}
