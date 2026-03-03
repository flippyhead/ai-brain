import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@repo/db/convex/_generated/api";

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

  // Look up via internal query — requires admin auth
  // Using the Convex admin client with CONVEX_DEPLOYMENT env var
  const adminClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  adminClient.setAdminAuth(process.env.CONVEX_DEPLOYMENT!);

  const apiKey = await adminClient.query(
    internal.models.apiKeys.private.findByHash,
    { keyHash },
  );
  if (!apiKey) return null;

  // Update last used (fire and forget)
  adminClient
    .mutation(internal.models.apiKeys.private.updateLastUsed, {
      id: apiKey._id,
    })
    .catch(() => {});

  return { userId: apiKey.userId, keyId: apiKey._id };
}
