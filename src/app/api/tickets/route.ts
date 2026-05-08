import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const dashboard = await getDashboardData();

  return NextResponse.json({
    source: dashboard.source,
    refreshedAt: dashboard.refreshedAt,
    tickets: dashboard.tickets,
  });
}
