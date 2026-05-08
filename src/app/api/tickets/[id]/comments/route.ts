import { NextResponse } from "next/server";
import { addTicketComment } from "@/lib/operations";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const body = typeof payload.body === "string" ? payload.body : "";
    const authorEmail =
      typeof payload.authorEmail === "string" ? payload.authorEmail : null;
    const comment = await addTicketComment(id, { body, authorEmail });

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
