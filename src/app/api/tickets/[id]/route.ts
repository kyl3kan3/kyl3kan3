import { NextResponse } from "next/server";
import { parseUpdateTicketInput, updateTicket } from "@/lib/operations";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const ticket = await updateTicket(id, parseUpdateTicketInput(payload));

    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update ticket",
      },
      { status: 400 },
    );
  }
}
