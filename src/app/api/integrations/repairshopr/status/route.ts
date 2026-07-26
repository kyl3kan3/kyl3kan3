import { NextResponse } from "next/server";
import {
  getRepairShoprConfig,
  getRepairShoprStatus,
  isRepairShoprRequestAuthorized,
} from "@/lib/repairshopr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isRepairShoprRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Invalid RepairShopr sync secret" },
      { status: 401 },
    );
  }

  try {
    const [config, status] = await Promise.all([
      Promise.resolve(getRepairShoprConfig()),
      getRepairShoprStatus(),
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
            : "Unable to read RepairShopr status",
      },
      { status: 500 },
    );
  }
}
