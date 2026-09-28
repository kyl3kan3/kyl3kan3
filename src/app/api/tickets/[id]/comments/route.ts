import { NextResponse } from "next/server";
import { addTicketComment } from "@/lib/operations";
import { appMutationFailure } from "@/lib/manager-request";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const denied = appMutationFailure(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const body = typeof payload.body === "string" ? payload.body : "";
    // Shared workspace credentials do not authenticate an individual email identity.
    const comment = await addTicketComment(id, { body, authorEmail: null });

    return NextResponse.json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to add comment",
      },
      { status: 400 },
    );
  }
}
