import { NextResponse } from "next/server";
import { createUser, parseCreateUserInput } from "@/lib/operations";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const user = await createUser(parseCreateUserInput(payload));

    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create user",
      },
      { status: 400 },
    );
  }
}
