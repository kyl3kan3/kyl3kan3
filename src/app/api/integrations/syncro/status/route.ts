import { NextResponse } from "next/server";
import {
  getSyncroConfig,
  getSyncroStatus,
  isSyncroRequestAuthorized,
} from "@/lib/syncro";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSyncroRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Syncro sync secret" },
      { status: 401 },
    );
  }

  try {
    const [config, status] = await Promise.all([
      Promise.resolve(getSyncroConfig()),
      getSyncroStatus(),
    ]);

    return NextResponse.json({
      ok: true,
      config,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to read Syncro status",
      },
      { status: 500 },
    );
  }
}
