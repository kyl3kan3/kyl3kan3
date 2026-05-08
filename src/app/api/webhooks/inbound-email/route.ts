import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import type { Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

type NormalizedAlert = {
  source: string;
  externalId: string | null;
  senderEmail: string | null;
  subject: string;
  bodyText: string;
  service: string;
  severity: string;
};

type IdRow = { id: string };
type TicketIdRow = { id: string; ticket_number: string };

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

function normalizeAlert(payload: Record<string, unknown>): NormalizedAlert {
  return {
    source: text(payload.source, "email"),
    externalId: text(payload.messageId ?? payload.id, "") || null,
    senderEmail: text(payload.from ?? payload.senderEmail, "") || null,
    subject: text(payload.subject, "Untitled alert"),
    bodyText: text(payload.text ?? payload.bodyText ?? payload.body, ""),
    service: text(payload.service ?? payload.host, "unknown-service"),
    severity: text(payload.severity ?? payload.priority, "unknown"),
  };
}

function fingerprint(alert: NormalizedAlert) {
  const normalizedSubject = alert.subject
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(error|warning|critical|resolved)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256")
    .update(`${alert.source}:${alert.service}:${normalizedSubject}`)
    .digest("hex")
    .slice(0, 32);
}

function scoreAlert(alert: NormalizedAlert) {
  const textToScore =
    `${alert.subject} ${alert.bodyText} ${alert.severity}`.toLowerCase();
  let importanceScore = 10;
  let urgencyScore = 10;

  if (textToScore.includes("customer") || textToScore.includes("checkout")) {
    importanceScore += 20;
  }

  if (textToScore.includes("revenue") || textToScore.includes("payment")) {
    importanceScore += 15;
  }

  if (textToScore.includes("security") || textToScore.includes("compliance")) {
    importanceScore += 15;
  }

  if (textToScore.includes("critical") || textToScore.includes("p1")) {
    urgencyScore += 20;
  }

  if (textToScore.includes("spike") || textToScore.includes("5xx")) {
    urgencyScore += 15;
  }

  if (textToScore.includes("repeat") || textToScore.includes("again")) {
    urgencyScore += 10;
  }

  const total = importanceScore + urgencyScore;
  const priority: Priority =
    total >= 80 ? "P1" : total >= 60 ? "P2" : total >= 35 ? "P3" : "P4";

  return { importanceScore, urgencyScore, priority };
}

function slaMinutes(priority: Priority) {
  if (priority === "P1") return 5;
  if (priority === "P2") return 15;
  if (priority === "P3") return 60;
  return 240;
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const rawPayload = await readPayload(request);
  const alert = normalizeAlert(rawPayload);
  const alertFingerprint = fingerprint(alert);
  const score = scoreAlert(alert);
  const sql = getSql();

  const orgRows = (await sql`
    insert into orgs (name)
    values ('Default Operations')
    on conflict (name) do update set name = excluded.name
    returning id
  `) as IdRow[];
  const orgId = String(orgRows[0].id);

  const alertRows = (await sql`
    insert into alert_events (
      org_id,
      source,
      external_id,
      sender_email,
      subject,
      body_text,
      raw_payload,
      fingerprint
    )
    values (
      ${orgId},
      ${alert.source},
      ${alert.externalId},
      ${alert.senderEmail},
      ${alert.subject},
      ${alert.bodyText},
      ${JSON.stringify(rawPayload)}::jsonb,
      ${alertFingerprint}
    )
    returning id
  `) as IdRow[];
  const alertId = String(alertRows[0].id);

  const existingIncidentRows = (await sql`
    select id
    from incidents
    where org_id = ${orgId}
      and dedup_key = ${alertFingerprint}
      and status in ('open', 'monitoring')
    order by last_seen_at desc
    limit 1
  `) as IdRow[];

  let incidentId = existingIncidentRows[0]?.id
    ? String(existingIncidentRows[0].id)
    : null;

  if (incidentId) {
    await sql`
      update incidents
      set
        last_seen_at = now(),
        blast_count = blast_count + 1,
        urgency_score = greatest(urgency_score, ${score.urgencyScore}),
        importance_score = greatest(importance_score, ${score.importanceScore}),
        priority = least(priority, ${score.priority})::text,
        updated_at = now()
      where id = ${incidentId}
    `;
  } else {
    const incidentRows = (await sql`
      insert into incidents (
        org_id,
        title,
        status,
        dedup_key,
        importance_score,
        urgency_score,
        priority,
        confidence,
        first_seen_at,
        last_seen_at,
        blast_count
      )
      values (
        ${orgId},
        ${alert.subject},
        'open',
        ${alertFingerprint},
        ${score.importanceScore},
        ${score.urgencyScore},
        ${score.priority},
        0.82,
        now(),
        now(),
        1
      )
      returning id
    `) as IdRow[];
    incidentId = String(incidentRows[0].id);
  }

  await sql`
    insert into incident_alert_links (incident_id, alert_event_id)
    values (${incidentId}, ${alertId})
    on conflict do nothing
  `;

  const existingTicketRows = (await sql`
    select id, ticket_number::text
    from tickets
    where incident_id = ${incidentId}
      and status not in ('resolved', 'closed')
    order by updated_at desc
    limit 1
  `) as TicketIdRow[];

  let ticketId = existingTicketRows[0]?.id
    ? String(existingTicketRows[0].id)
    : null;
  let ticketNumber = existingTicketRows[0]?.ticket_number
    ? String(existingTicketRows[0].ticket_number)
    : null;

  if (ticketId) {
    await sql`
      update tickets
      set
        updated_at = now(),
        priority = least(priority, ${score.priority})::text,
        urgency_score = greatest(urgency_score, ${score.urgencyScore}),
        importance_score = greatest(importance_score, ${score.importanceScore})
      where id = ${ticketId}
    `;
  } else {
    const ticketRows = (await sql`
      insert into tickets (
        org_id,
        incident_id,
        title,
        description,
        status,
        priority,
        importance_score,
        urgency_score,
        sla_due_at,
        reporter_email
      )
      values (
        ${orgId},
        ${incidentId},
        ${alert.subject},
        ${alert.bodyText},
        'new',
        ${score.priority},
        ${score.importanceScore},
        ${score.urgencyScore},
        now() + (${slaMinutes(score.priority)} || ' minutes')::interval,
        ${alert.senderEmail}
      )
      returning id, ticket_number::text
    `) as TicketIdRow[];
    ticketId = String(ticketRows[0].id);
    ticketNumber = String(ticketRows[0].ticket_number);
  }

  return NextResponse.json(
    {
      ok: true,
      alertId,
      incidentId,
      ticketId,
      ticketNumber,
      priority: score.priority,
      fingerprint: alertFingerprint,
    },
    { status: 202 },
  );
}
