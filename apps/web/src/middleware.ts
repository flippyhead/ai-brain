import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";

import { shouldRewriteMcpRootRequest } from "@/lib/mcp/root-alias";

const isSignInPage = createRouteMatcher(["/sign-in", "/sign-up"]);
const isPublicRoute = createRouteMatcher([
  "/sign-in",
  "/sign-up",
  "/api/mcp(.*)",
  "/mcp/authorize",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (
    shouldRewriteMcpRootRequest(
      request.nextUrl.pathname,
      request.method,
      request.headers.get("content-type"),
      request.headers.get("authorization"),
    )
  ) {
    const target = request.nextUrl.clone();
    target.pathname = "/api/mcp";
    return NextResponse.rewrite(target);
  }

  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (!isPublicRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/sign-in");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)"],
};
