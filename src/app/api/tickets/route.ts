import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { createTicket, parseCreateTicketInput } from "@/lib/operations";
import { appAccessFailure, isAppAccessAuthorized } from "@/lib/manager-auth";
import { appMutationFailure } from "@/lib/manager-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAppAccessAuthorized(request)) return appAccessFailure();
  const dashboard = await getDashboardData();

  return NextResponse.json({
    source: dashboard.source,
    refreshedAt: dashboard.refreshedAt,
    tickets: dashboard.tickets,
  });
}

export async function POST(request: Request) {
  const denied = appMutationFailure(request);
  if (denied) return denied;
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
