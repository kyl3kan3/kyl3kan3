import { NextResponse } from "next/server";
import {
  isSyncroRequestAuthorized,
  testSyncroConnection,
} from "@/lib/syncro";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSyncroRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Syncro sync secret" },
      { status: 401 },
    );
  }

  try {
    const result = await testSyncroConnection();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Syncro connection test failed",
      },
      { status: 500 },
    );
  }
}
