import { NextResponse } from "next/server";
import {
  isSyncroRequestAuthorized,
  getSyncroConfig,
  syncSyncro,
} from "@/lib/syncro";

export const dynamic = "force-dynamic";

async function handleSync(request: Request) {
  if (!isSyncroRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Syncro sync secret" },
      { status: 401 },
    );
  }

  try {
    if (request.method === "GET" && !getSyncroConfig().configured) {
      return NextResponse.json({ ok: true, skipped: "syncro_not_configured" });
    }
    const result = await syncSyncro();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Syncro sync failed",
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
