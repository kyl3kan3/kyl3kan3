import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({
      ok: true,
      database: "not_configured",
    });
  }

  try {
    const sql = getSql();
    await sql`select 1 as ok`;

    return NextResponse.json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
