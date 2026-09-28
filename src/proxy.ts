import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  appAccessFailure,
  isAppAccessAuthorized,
  isManagerDashboardAuthorized,
  managerDashboardAccessFailure,
} from "@/lib/manager-auth";

export function proxy(request: NextRequest) {
  function accessFailure(manager: boolean) {
    const failure = manager ? managerDashboardAccessFailure() : appAccessFailure();
    if (!request.nextUrl.pathname.startsWith("/api/") && failure.status === 401) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      if (manager) url.searchParams.set("manager", "1");
      const response = NextResponse.redirect(url);
      response.headers.set("cache-control", "no-store");
      return response;
    }
    return failure;
  }
  const managerRoute =
    request.nextUrl.pathname === "/settings" ||
    request.nextUrl.pathname.startsWith("/settings/") ||
    request.nextUrl.pathname === "/quality" ||
    request.nextUrl.pathname.startsWith("/quality/") ||
    request.nextUrl.pathname === "/api/quality" ||
    request.nextUrl.pathname === "/api/users" ||
    request.nextUrl.pathname === "/api/teams" ||
    ["/api/operations", "/api/directory", "/api/routing-rules", "/api/readiness"].includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/api/quality/");
  if (managerRoute) {
    if (!isManagerDashboardAuthorized(request)) {
      return accessFailure(true);
    }
  } else if (!isAppAccessAuthorized(request)) {
    return accessFailure(false);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/tickets/:path*",
    "/archive/:path*",
    "/overview/:path*",
    "/settings/:path*",
    "/quality/:path*",
    "/api/dashboard/:path*",
    "/api/integration-test/:path*",
    "/api/quality/:path*",
    "/api/teams/:path*",
    "/api/tickets/:path*",
    "/api/users/:path*",
    "/api/operations/:path*",
    "/api/directory/:path*",
    "/api/routing-rules/:path*",
    "/api/readiness/:path*",
  ],
};
