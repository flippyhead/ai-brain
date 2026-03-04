import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/db/convex/_generated/api";
import { encryptAuthCode } from "@/lib/mcp/oauth";

export async function POST(req: Request) {
  const { clientId, redirectUri, codeChallenge, state } = await req.json();

  if (!redirectUri || !codeChallenge) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Read auth cookie set by Convex Auth
  const token = await convexAuthNextjsToken();
  if (!token) {
    return new Response("Not authenticated", { status: 401 });
  }

  // Create an API key on behalf of the authenticated user
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);

  let rawKey: string;
  try {
    const result = await convex.mutation(api.models.apiKeys.public.create, {
      name: "MCP (auto)",
    });
    rawKey = result.rawKey;
  } catch {
    return new Response("Failed to create API key", { status: 500 });
  }

  // Encrypt auth code (stateless)
  const code = encryptAuthCode({
    apiKey: rawKey,
    codeChallenge,
    redirectUri,
    exp: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return Response.json({ redirect_url: redirect.toString() });
}
