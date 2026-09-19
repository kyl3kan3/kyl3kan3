import { NextResponse } from "next/server";
import {
  isManagerDashboardAuthorized,
  managerDashboardAccessFailure,
} from "@/lib/manager-auth";
import { getManagerQualityData } from "@/lib/quality-dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isManagerDashboardAuthorized(request)) {
    return managerDashboardAccessFailure();
  }
  const url = new URL(request.url);
  const windowDays = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
  const data = await getManagerQualityData(windowDays);
  return NextResponse.json(data, { status: data.dbError ? 503 : 200 });
}
