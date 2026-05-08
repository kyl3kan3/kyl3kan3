import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { createTicket, parseCreateTicketInput } from "@/lib/operations";

export const dynamic = "force-dynamic";

export async function GET() {
  const dashboard = await getDashboardData();

  return NextResponse.json({
    source: dashboard.source,
    refreshedAt: dashboard.refreshedAt,
    tickets: dashboard.tickets,
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const ticket = await createTicket(parseCreateTicketInput(payload));

    return NextResponse.json({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create ticket",
      },
      { status: 400 },
    );
  }
}
