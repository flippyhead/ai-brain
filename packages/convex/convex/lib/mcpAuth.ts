import type { Id } from "../_generated/dataModel";

type AuthenticatedFunctionContext = {
  auth: {
    getUserIdentity(): Promise<{
      issuer: string;
      subject: string;
    } | null>;
  };
};

export async function requireMcpUserId(
  ctx: AuthenticatedFunctionContext,
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  const expectedIssuer = process.env.MCP_JWT_ISSUER;

  if (!identity || !expectedIssuer || identity.issuer !== expectedIssuer) {
    throw new Error("Not authenticated");
  }

  // The MCP gateway sets sub only after resolving a valid API key to a
  // concrete Convex user. Callers cannot supply or override this value.
  return identity.subject as Id<"users">;
}
