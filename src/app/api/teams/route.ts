import { NextResponse } from "next/server";
import { createTeam, parseCreateTeamInput } from "@/lib/operations";
import { managerRequestFailure } from "@/lib/manager-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const team = await createTeam(parseCreateTeamInput(payload));

    return NextResponse.json({ ok: true, team }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create team",
      },
      { status: 400 },
    );
  }
}
