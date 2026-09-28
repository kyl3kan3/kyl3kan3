import { isJevConfigured } from "@/lib/jev-config";
import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({
      ok: process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1",
      database: "not_configured",
      jev: isJevConfigured() ? "configured" : "not_configured",
    }, { status: process.env.NODE_ENV === "production" || process.env.VERCEL === "1" ? 503 : 200 });
  }

  try {
    const sql = getSql();
    await sql`select 1 as ok`;

    return NextResponse.json({
      ok: true,
      database: "connected",
      jev: isJevConfigured() ? "configured" : "not_configured",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        error: "Database connection unavailable",
      },
      { status: 500 },
    );
  }
}
