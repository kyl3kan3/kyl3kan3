import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { createTicket } from "@/lib/operations";
import type { Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

type NormalizedAlert = {
  source: string;
  externalId: string | null;
  senderEmail: string | null;
  recipientEmail: string | null;
  subject: string;
  bodyText: string;
  service: string;
  severity: string;
  createdFrom: "alert_email" | "client_email";
};

type IdRow = { id: string };
type TicketIdRow = { id: string; ticket_number: string };

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function base64UrlToBase64(value: string) {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function atPath(payload: Record<string, unknown>, path: string[]) {
  let current: unknown = payload;

  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }

  return "";
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmailAddress(value: unknown) {
  const raw = text(value);
  if (!raw) return "";

  const bracketMatch = raw.match(/<([^>]+)>/);
  const email = bracketMatch?.[1] ?? raw.match(/[^\s@<>]+@[^\s@<>]+/)?.[0];
  return email?.trim().toLowerCase() ?? raw.toLowerCase();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        if (isRecord(entry)) {
          return [
            entry.email,
            entry.Email,
            entry.address,
            entry.Address,
            entry.Name && entry.Email
              ? `${entry.Name} <${entry.Email}>`
              : undefined,
          ];
        }

        return entry;
      })
      .map(extractEmailAddress)
      .filter(Boolean);
  }

  const single = extractEmailAddress(value);
  return single ? [single] : [];
}

function formValue(value: FormDataEntryValue) {
  if (typeof value === "string") return value;

  return {
    filename: value.name,
    contentType: value.type,
    size: value.size,
  };
}

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }

  const formData = await request.formData();
  const payload: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    const nextValue = formValue(value);
    const existing = payload[key];

    if (existing === undefined) {
      payload[key] = nextValue;
    } else if (Array.isArray(existing)) {
      existing.push(nextValue);
    } else {
      payload[key] = [existing, nextValue];
    }
  }

  return payload;
}

async function enrichPayload(payload: Record<string, unknown>) {
  const eventType = text(payload.type);
  const emailId = text(atPath(payload, ["data", "email_id"]));
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (eventType !== "email.received" || !emailId || !apiKey) {
    return payload;
  }

  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    return payload;
  }

  const responseBody = (await response.json()) as Record<string, unknown>;
  const receivedEmail = isRecord(responseBody.data)
    ? responseBody.data
    : responseBody;
  const data = isRecord(payload.data) ? payload.data : {};

  return {
    ...payload,
    data: {
      ...data,
      text: firstText(data.text, receivedEmail.text, receivedEmail.text_body),
      html: firstText(data.html, receivedEmail.html, receivedEmail.html_body),
      headers: receivedEmail.headers,
    },
    receivedEmail,
  };
}

function recipientEmails(payload: Record<string, unknown>) {
  return [
    ...stringList(atPath(payload, ["data", "to"])),
    ...stringList(payload.to),
    ...stringList(payload.To),
    ...stringList(payload.recipient),
    ...stringList(payload.recipients),
    ...stringList(payload.envelope),
  ];
}

function classifyEmail(
  payload: Record<string, unknown>,
  subject: string,
  bodyText: string,
) {
  const recipients = recipientEmails(payload);
  const haystack = `${recipients.join(" ")} ${subject} ${bodyText}`.toLowerCase();

  if (
    /\b(alert|alerts|incident|incidents|monitor|monitoring|pager|ops|noc|sre)\b/.test(
      haystack,
    )
  ) {
    return "alert_email" as const;
  }

  if (
    /\b(client|customer|support|help|ticket|request|inquiry|billing)\b/.test(
      haystack,
    )
  ) {
    return "client_email" as const;
  }

  return "client_email" as const;
}

function normalizeAlert(payload: Record<string, unknown>): NormalizedAlert {
  const htmlBody = firstText(
    atPath(payload, ["data", "html"]),
    payload.html,
    payload.HtmlBody,
    payload["body-html"],
  );
  const bodyText =
    firstText(
      atPath(payload, ["data", "text"]),
      payload.text,
      payload.TextBody,
      payload.StrippedTextReply,
      payload.bodyText,
      payload.body,
      payload["body-plain"],
    ) || stripHtml(htmlBody);
  const recipients = recipientEmails(payload);
  const subject = firstText(
    atPath(payload, ["data", "subject"]),
    payload.subject,
    payload.Subject,
    "Untitled alert",
  );
  const createdFrom = classifyEmail(payload, subject, bodyText);

  return {
    source: firstText(
      payload.source,
      payload.provider,
      text(payload.type) === "email.received" ? "resend" : "",
      "email",
    ),
    externalId:
      firstText(
        atPath(payload, ["data", "email_id"]),
        atPath(payload, ["data", "message_id"]),
        payload.messageId,
        payload.MessageID,
        payload["Message-Id"],
        payload.id,
      ) || null,
    senderEmail:
      extractEmailAddress(
        firstText(
          atPath(payload, ["data", "from"]),
          atPath(payload, ["FromFull", "Email"]),
          payload.from,
          payload.From,
          payload.sender,
          payload.senderEmail,
        ),
      ) || null,
    recipientEmail: recipients[0] ?? null,
    subject,
    bodyText,
    service: firstText(
      payload.service,
      payload.host,
      recipients[0]?.split("@")[0],
      "unknown-service",
    ),
    severity: firstText(payload.severity, payload.priority, "unknown"),
    createdFrom,
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
  let importanceScore = alert.createdFrom === "client_email" ? 20 : 10;
  let urgencyScore = alert.createdFrom === "client_email" ? 15 : 10;

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

function isAuthorized(request: Request) {
  const expected = process.env.INBOUND_WEBHOOK_SECRET?.trim();

  if (!expected) {
    return true;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-webhook-secret")?.trim() ?? "";

  return bearer === expected || headerSecret === expected;
}

function hasSvixHeaders(request: Request) {
  return Boolean(
    request.headers.get("svix-id") &&
      request.headers.get("svix-timestamp") &&
      request.headers.get("svix-signature"),
  );
}

function verifySvixSignature(request: Request, payload: string) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatureHeader = request.headers.get("svix-signature");

  if (!secret || !id || !timestamp || !signatureHeader) {
    return false;
  }

  const timestampNumber = Number(timestamp);
  const fiveMinutes = 5 * 60;
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() / 1000 - timestampNumber) > fiveMinutes
  ) {
    return false;
  }

  const secretKey = secret.startsWith("whsec_")
    ? Buffer.from(base64UrlToBase64(secret.slice("whsec_".length)), "base64")
    : Buffer.from(secret);
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", secretKey)
    .update(signedContent)
    .digest();

  return signatureHeader
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      const [version, signature] = entry.split(",");
      if (version !== "v1" || !signature) return false;

      const received = Buffer.from(base64UrlToBase64(signature), "base64");
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    });
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  if (hasSvixHeaders(request)) {
    const rawBody = await request.text();
    if (!verifySvixSignature(request, rawBody)) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook signature" },
        { status: 401 },
      );
    }

    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } else {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook secret" },
        { status: 401 },
      );
    }

    payload = await readPayload(request);
  }

  const rawPayload = await enrichPayload(payload);
  const alert = normalizeAlert(rawPayload);
  const alertFingerprint = fingerprint(alert);
  const score = scoreAlert(alert);

  if (!hasDatabaseUrl()) {
    const ticket = await createTicket({
      title: alert.subject,
      description: alert.bodyText,
      priority: score.priority,
      reporterEmail: alert.senderEmail,
      comment: `Demo webhook intake from ${alert.source}.`,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: "demo",
        alertId: `demo-alert-${Date.now()}`,
        incidentId: null,
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        priority: score.priority,
        createdFrom: alert.createdFrom,
        recipientEmail: alert.recipientEmail,
        fingerprint: alertFingerprint,
      },
      { status: 202 },
    );
  }

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

    if (alert.createdFrom === "client_email" && alert.bodyText) {
      await sql`
        insert into ticket_comments (
          ticket_id,
          author_email,
          body,
          created_via
        )
        values (
          ${ticketId},
          ${alert.senderEmail},
          ${alert.bodyText},
          'email'
        )
      `;
    }
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
        reporter_email,
        created_from
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
        ${alert.senderEmail},
        ${alert.createdFrom}
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
      createdFrom: alert.createdFrom,
      recipientEmail: alert.recipientEmail,
      fingerprint: alertFingerprint,
    },
    { status: 202 },
  );
}
