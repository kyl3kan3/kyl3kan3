import { NextResponse } from "next/server";
import {
  isRepairShoprRequestAuthorized,
  testRepairShoprConnection,
} from "@/lib/repairshopr";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isRepairShoprRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid RepairShopr sync secret" },
      { status: 401 },
    );
  }

  try {
    const result = await testRepairShoprConnection();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "RepairShopr connection test failed",
      },
      { status: 500 },
    );
  }
}
