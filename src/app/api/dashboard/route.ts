import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import type { DashboardTicketScope } from "@/lib/dashboard";
import { appAccessFailure, isAppAccessAuthorized } from "@/lib/manager-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAppAccessAuthorized(request)) return appAccessFailure();
  const url = new URL(request.url);
  const requestedScope = url.searchParams.get("ticketScope");
  const ticketScope: DashboardTicketScope =
    requestedScope === "active" || requestedScope === "archive"
      ? requestedScope
      : "mixed";
  const ticketLimit = Number.parseInt(
    url.searchParams.get("ticketLimit") ?? "50",
    10,
  );
  const ticketOffset = Number.parseInt(
    url.searchParams.get("ticketOffset") ?? "0",
    10,
  );
  const dashboard = await getDashboardData({
    ticketScope,
    ticketId: url.searchParams.get("ticketId"),
    ticketLimit,
    ticketOffset,
  });
  return NextResponse.json(dashboard);
}
