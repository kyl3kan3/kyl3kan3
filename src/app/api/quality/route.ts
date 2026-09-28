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
  const requestedDays = (url.searchParams.get("days") ?? "30").trim();
  const windowDays = /^\d+$/.test(requestedDays) ? Number(requestedDays) : 30;
  try {
    const data = await getManagerQualityData(windowDays);
    return NextResponse.json(data, { status: data.dbError ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Quality metrics are unavailable. Check the database connection." }, { status: 503 });
  }
}
