import { NextResponse } from "next/server";
import {
  isRepairShoprRequestAuthorized,
  getRepairShoprConfig,
  syncRepairShopr,
} from "@/lib/repairshopr";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleSync(request: Request) {
  if (!isRepairShoprRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid RepairShopr sync secret" },
      { status: 401 },
    );
  }

  try {
    if (request.method === "GET" && !getRepairShoprConfig().configured) {
      return NextResponse.json({ ok: true, skipped: "repairshopr_not_configured" });
    }
    const result = await syncRepairShopr();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "RepairShopr sync failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleSync(request);
}

export async function POST(request: Request) {
  return handleSync(request);
}
