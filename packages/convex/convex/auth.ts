import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Session lasts ~10 years — effectively permanent until explicit logout
const TEN_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 10;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
  session: {
    totalDurationMs: TEN_YEARS_MS,
  },
});
