import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  appAccessFailure,
  isAppAccessAuthorized,
  isManagerDashboardAuthorized,
  managerDashboardAccessFailure,
} from "@/lib/manager-auth";

export function proxy(request: NextRequest) {
  const managerRoute =
    request.nextUrl.pathname === "/quality" ||
    request.nextUrl.pathname.startsWith("/quality/") ||
    request.nextUrl.pathname === "/api/quality" ||
    request.nextUrl.pathname.startsWith("/api/quality/");
  if (managerRoute) {
    if (!isManagerDashboardAuthorized(request)) {
      return managerDashboardAccessFailure();
    }
  } else if (!isAppAccessAuthorized(request)) {
    return appAccessFailure();
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
  ],
};
