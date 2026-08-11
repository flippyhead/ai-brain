import { getAuthUserId } from "@convex-dev/auth/server";

import type { Id } from "../_generated/dataModel";

type AuthenticatedFunctionContext = {
  auth: {
    getUserIdentity(): Promise<{
      issuer: string;
      subject: string;
    } | null>;
  };
};

/**
 * Session identity for the dashboard's own function surface.
 *
 * `getAuthUserId` derives the account from `identity.subject` alone and does
 * not look at the issuer, so it accepts a token from any configured provider —
 * including the short-lived identities the MCP gateway mints from API keys.
 * Those keys are scoped to the MCP tool surface; a token minted from one must
 * not reach functions like `apiKeys.public.create`, which can issue further
 * credentials. `requireMcpUserId` pins the MCP issuer from the other
 * direction; this pins it from this one, so the two identity domains stay
 * separate instead of one silently subsuming the other.
 */
export async function requireWebUserId(
  ctx: AuthenticatedFunctionContext & Parameters<typeof getAuthUserId>[0],
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const mcpIssuer = process.env.MCP_JWT_ISSUER;
  if (mcpIssuer && identity.issuer === mcpIssuer) {
    throw new Error("Not authenticated");
  }

  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}
