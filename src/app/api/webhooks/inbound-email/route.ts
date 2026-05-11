import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  triageIncomingAlert,
  type AssignmentContext,
  type AlertTriageDecision,
} from "@/lib/ai-triage";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { getDemoDashboardData } from "@/lib/demo-store";
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
type TicketIdRow = {
  id: string;
  ticket_number: string;
  assigned_team_id: string | null;
  assigned_user_id: string | null;
};
type TeamAssignmentRow = {
  id: string;
  name: string;
  open_tickets: number | string | null;
  urgent_tickets: number | string | null;
  members: number | string | null;
  on_call: number | string | null;
};
type UserAssignmentRow = {
  id: string;
  email: string;
  full_name: string | null;
  team_ids: string[] | null;
  is_on_call: boolean | null;
  open_tickets: number | string | null;
};

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

function parseJsonRecord(value: unknown) {
  if (!text(value)) return null;

  try {
    const parsed = JSON.parse(text(value));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapPayload(payload: Record<string, unknown>) {
  const candidates = [
    payload,
    isRecord(payload.payload) ? payload.payload : null,
    isRecord(payload.body) ? payload.body : null,
    isRecord(payload.event) ? payload.event : null,
    isRecord(payload.record) ? payload.record : null,
    parseJsonRecord(payload.payload),
    parseJsonRecord(payload.body),
    parseJsonRecord(payload.event),
    parseJsonRecord(payload.record),
  ].filter(isRecord);

  return (
    candidates.find(
      (candidate) =>
        text(candidate.type) === "email.received" || isRecord(candidate.data),
    ) ?? payload
  );
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

const SUBJECT_KEYS = new Set(["subject"]);
const FROM_KEYS = new Set([
  "from",
  "sender",
  "fromaddress",
  "from_address",
  "senderemail",
  "sender_email",
]);
const TEXT_KEYS = new Set([
  "text",
  "textbody",
  "text_body",
  "plain",
  "plaintext",
  "plain_text",
  "plainbody",
  "plain_body",
  "bodytext",
  "body_text",
  "stripped_text",
  "strippedtext",
  "strippedtextreply",
  "body-plain",
]);
const HTML_KEYS = new Set([
  "html",
  "htmlbody",
  "html_body",
  "bodyhtml",
  "body_html",
  "body-html",
]);
const RECIPIENT_KEYS = new Set(["to", "recipient", "recipients", "destination"]);
const DEEP_SEARCH_SKIP = new Set(["attachments", "headers", "raw_payload"]);

function deepFindFirst(
  payload: unknown,
  keys: ReadonlySet<string>,
  visited: WeakSet<object> = new WeakSet(),
): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  if (visited.has(payload as object)) return undefined;
  visited.add(payload as object);

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = deepFindFirst(entry, keys, visited);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (
      keys.has(key.toLowerCase()) &&
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return value;
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (DEEP_SEARCH_SKIP.has(key.toLowerCase())) continue;
    const found = deepFindFirst(value, keys, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deepFindString(payload: unknown, keys: ReadonlySet<string>) {
  const value = deepFindFirst(payload, keys);
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "";
}

function deepFindList(payload: unknown, keys: ReadonlySet<string>) {
  const value = deepFindFirst(payload, keys);
  if (value === undefined) return [];
  return stringList(value);
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
    const payload = (await request.json()) as unknown;
    if (!isRecord(payload)) {
      throw new Error("Webhook payload must be a JSON object");
    }
    return payload;
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

function parseRawJsonPayload(rawBody: string) {
  const payload = JSON.parse(rawBody) as unknown;
  if (!isRecord(payload)) {
    throw new Error("Webhook payload must be a JSON object");
  }
  return payload;
}

function badPayloadResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Webhook payload must be valid JSON",
    },
    { status: 400 },
  );
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function demoAssignmentContext(): AssignmentContext {
  const dashboard = getDemoDashboardData();
  return {
    teams: dashboard.teams.map((team) => {
      const load = dashboard.teamLoad.find((item) => item.team === team.name);
      return {
        id: team.id,
        name: team.name,
        openTickets: load?.openTickets ?? 0,
        urgentTickets: load?.urgentTickets ?? 0,
        members: team.members,
        onCall: team.onCall,
      };
    }),
    users: dashboard.users.map((user) => {
      const openTickets = dashboard.tickets.filter(
        (ticket) =>
          ticket.assignedUserId === user.id &&
          ticket.status !== "resolved" &&
          ticket.status !== "closed",
      ).length;
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        teamIds: user.teamIds,
        isOnCall: user.onCall,
        openTickets,
      };
    }),
  };
}

async function ensureDefaultAssignee(orgId: string) {
  const sql = getSql();
  const teamRows = (await sql`
    insert into teams (org_id, name)
    values (${orgId}, 'General')
    on conflict (org_id, name) do update set name = excluded.name
    returning id
  `) as IdRow[];
  const userRows = (await sql`
    insert into users (org_id, email, full_name, role, is_active)
    values (${orgId}, 'operator@example.com', 'Operations', 'agent', true)
    on conflict (org_id, email) do update
      set full_name = excluded.full_name,
          role = excluded.role,
          is_active = true
    returning id
  `) as IdRow[];

  await sql`
    insert into team_members (team_id, user_id, is_on_call)
    values (${teamRows[0].id}, ${userRows[0].id}, true)
    on conflict (team_id, user_id) do update set is_on_call = true
  `;
}

async function assignmentContext(orgId: string): Promise<AssignmentContext> {
  const sql = getSql();
  const [teamRows, userRows] = await Promise.all([
    sql`
      select
        tm.id,
        tm.name,
        count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets,
        count(t.id) filter (
          where t.priority in ('P1', 'P2') and t.status not in ('resolved', 'closed')
        )::int as urgent_tickets,
        count(distinct team_members.user_id)::int as members,
        count(distinct team_members.user_id) filter (where team_members.is_on_call)::int as on_call
      from teams tm
      left join team_members on team_members.team_id = tm.id
      left join tickets t on t.assigned_team_id = tm.id
      where tm.org_id = ${orgId}
      group by tm.id, tm.name
      order by open_tickets asc, tm.name asc
    `,
    sql`
      select
        u.id,
        u.email,
        u.full_name,
        coalesce(array_remove(array_agg(team_members.team_id::text), null), '{}') as team_ids,
        coalesce(bool_or(team_members.is_on_call), false) as is_on_call,
        count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets
      from users u
      left join team_members on team_members.user_id = u.id
      left join tickets t on t.assigned_user_id = u.id
      where u.org_id = ${orgId}
        and u.is_active
      group by u.id, u.email, u.full_name
      order by open_tickets asc, u.full_name asc nulls last, u.email asc
    `,
  ]);

  let context: AssignmentContext = {
    teams: (teamRows as TeamAssignmentRow[]).map((team) => ({
      id: String(team.id),
      name: team.name,
      openTickets: toNumber(team.open_tickets),
      urgentTickets: toNumber(team.urgent_tickets),
      members: toNumber(team.members),
      onCall: toNumber(team.on_call),
    })),
    users: (userRows as UserAssignmentRow[]).map((user) => ({
      id: String(user.id),
      email: user.email,
      fullName: user.full_name,
      teamIds: user.team_ids ?? [],
      isOnCall: Boolean(user.is_on_call),
      openTickets: toNumber(user.open_tickets),
    })),
  };

  if (context.teams.length === 0 || context.users.length === 0) {
    await ensureDefaultAssignee(orgId);
    context = await assignmentContext(orgId);
  }

  return context;
}

async function enrichPayload(payload: Record<string, unknown>) {
  const eventPayload = unwrapPayload(payload);
  const eventType = text(eventPayload.type);
  const emailId = firstText(
    atPath(eventPayload, ["data", "email_id"]),
    atPath(eventPayload, ["data", "id"]),
    eventPayload.email_id,
    eventPayload.emailId,
  );
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (eventType !== "email.received" || !emailId || !apiKey) {
    return eventPayload;
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
    console.warn("resend_received_email_fetch_failed", {
      status: response.status,
      eventType,
      hasEmailId: Boolean(emailId),
    });
    return eventPayload;
  }

  const responseBody = (await response.json()) as Record<string, unknown>;
  const receivedEmail = isRecord(responseBody.data)
    ? responseBody.data
    : responseBody;
  const data = isRecord(eventPayload.data) ? eventPayload.data : {};

  return {
    ...eventPayload,
    data: {
      ...data,
      email_id: firstText(data.email_id, receivedEmail.id, emailId),
      message_id: firstText(data.message_id, receivedEmail.message_id),
      subject: firstText(data.subject, receivedEmail.subject),
      from: firstText(data.from, receivedEmail.from),
      to: data.to ?? receivedEmail.to,
      cc: data.cc ?? receivedEmail.cc,
      bcc: data.bcc ?? receivedEmail.bcc,
      text: firstText(data.text, receivedEmail.text, receivedEmail.text_body),
      html: firstText(data.html, receivedEmail.html, receivedEmail.html_body),
      headers: receivedEmail.headers,
    },
    receivedEmail,
  };
}

function recipientEmails(payload: Record<string, unknown>) {
  const direct = [
    ...stringList(atPath(payload, ["data", "to"])),
    ...stringList(atPath(payload, ["receivedEmail", "to"])),
    ...stringList(payload.to),
    ...stringList(payload.To),
    ...stringList(payload.recipient),
    ...stringList(payload.recipients),
    ...stringList(payload.envelope),
  ];
  if (direct.length > 0) return direct;
  return deepFindList(payload, RECIPIENT_KEYS);
}

function envList(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function recipientEmailDomain(value: string | null) {
  if (!value) return null;
  const email = extractEmailAddress(value);
  const [, domain] = email.split("@");
  return domain?.toLowerCase() ?? null;
}

function rejectDisallowedRecipient(alert: NormalizedAlert) {
  const allowedRecipients = envList("ALLOWED_INBOUND_RECIPIENTS").map(
    extractEmailAddress,
  );
  const allowedDomains = envList("ALLOWED_INBOUND_RECIPIENT_DOMAINS").map(
    (domain) => domain.replace(/^@/, ""),
  );

  if (allowedRecipients.length === 0 && allowedDomains.length === 0) {
    return null;
  }

  const recipientEmail = alert.recipientEmail
    ? extractEmailAddress(alert.recipientEmail)
    : null;
  const recipientDomain = recipientEmailDomain(alert.recipientEmail);
  const isAllowed =
    (recipientEmail ? allowedRecipients.includes(recipientEmail) : false) ||
    (recipientDomain ? allowedDomains.includes(recipientDomain) : false);

  if (isAllowed) return null;

  return NextResponse.json(
    {
      ok: false,
      error: "Inbound recipient is not allowed for this app",
      recipientEmail,
      allowedDomains,
    },
    { status: 403 },
  );
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
  const htmlBody =
    firstText(
      atPath(payload, ["data", "html"]),
      atPath(payload, ["receivedEmail", "html"]),
      payload.html,
      payload.HtmlBody,
      payload["body-html"],
    ) || deepFindString(payload, HTML_KEYS);
  const bodyText =
    firstText(
      atPath(payload, ["data", "text"]),
      atPath(payload, ["receivedEmail", "text"]),
      payload.text,
      payload.TextBody,
      payload.StrippedTextReply,
      payload.bodyText,
      payload.body,
      payload["body-plain"],
    ) ||
    deepFindString(payload, TEXT_KEYS) ||
    stripHtml(htmlBody);
  const recipients = recipientEmails(payload);
  const subject =
    firstText(
      atPath(payload, ["data", "subject"]),
      atPath(payload, ["receivedEmail", "subject"]),
      payload.subject,
      payload.Subject,
    ) ||
    deepFindString(payload, SUBJECT_KEYS) ||
    "Untitled alert";
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
          atPath(payload, ["receivedEmail", "from"]),
          atPath(payload, ["FromFull", "Email"]),
          payload.from,
          payload.From,
          payload.sender,
          payload.senderEmail,
        ) || deepFindString(payload, FROM_KEYS),
      ) || null,
    recipientEmail: extractEmailAddress(recipients[0]) || null,
    subject,
    bodyText,
    service: firstText(
      payload.service,
      payload.host,
      extractEmailAddress(recipients[0])?.split("@")[0],
      "unknown-service",
    ),
    severity: firstText(payload.severity, payload.priority, "unknown"),
    createdFrom,
  };
}

function fingerprint(alert: NormalizedAlert, dedupHint = "") {
  const normalizedSubject = alert.subject
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(error|warning|critical|resolved)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedHint = dedupHint
    .toLowerCase()
    .replace(/[^a-z0-9\s:_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256")
    .update(
      `${alert.source}:${alert.service}:${normalizedSubject}:${normalizedHint}`,
    )
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

  if (
    textToScore.includes("critical") ||
    textToScore.includes("p1") ||
    textToScore.includes("high priority")
  ) {
    urgencyScore += 20;
  }

  if (
    textToScore.includes("high priority") ||
    textToScore.includes("important")
  ) {
    importanceScore += 20;
  }

  if (
    textToScore.includes("immediately") ||
    textToScore.includes("urgent") ||
    textToScore.includes("asap") ||
    textToScore.includes("right away") ||
    textToScore.includes("need to fix")
  ) {
    urgencyScore += 25;
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

function logParseDiagnostic(
  payload: Record<string, unknown>,
  alert: NormalizedAlert,
) {
  const data = isRecord(payload.data) ? payload.data : {};
  const receivedEmail = isRecord(payload.receivedEmail)
    ? payload.receivedEmail
    : {};

  console.info("inbound_email_parsed", {
    type: text(payload.type),
    rootKeys: Object.keys(payload).slice(0, 12),
    dataKeys: Object.keys(data).slice(0, 12),
    receivedEmailKeys: Object.keys(receivedEmail).slice(0, 12),
    hasSubject: alert.subject !== "Untitled alert",
    hasBody: alert.bodyText.length > 0,
    hasSender: Boolean(alert.senderEmail),
    recipientEmail: alert.recipientEmail,
    source: alert.source,
    createdFrom: alert.createdFrom,
  });
}

async function writeAiTriageAudit({
  orgId,
  ticketId,
  decision,
  reassignedExistingTicket,
}: {
  orgId: string;
  ticketId: string;
  decision: AlertTriageDecision;
  reassignedExistingTicket: boolean;
}) {
  const sql = getSql();
  await sql`
    insert into audit_logs (
      org_id,
      actor_type,
      entity_type,
      entity_id,
      action,
      metadata
    )
    values (
      ${orgId},
      'system',
      'ticket',
      ${ticketId},
      'ai.triaged',
      ${JSON.stringify({
        model: decision.model,
        usedAi: decision.usedAi,
        fallbackReason: decision.fallbackReason,
        confidence: decision.confidence,
        priority: decision.priority,
        importanceScore: decision.importanceScore,
        urgencyScore: decision.urgencyScore,
        assignedTeamId: decision.assignedTeamId,
        assignedUserId: decision.assignedUserId,
        createdFrom: decision.createdFrom,
        service: decision.service,
        severity: decision.severity,
        dedupHint: decision.dedupHint,
        reasoning: decision.reasoning,
        reassignedExistingTicket,
      })}::jsonb
    )
  `;
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

    try {
      payload = parseRawJsonPayload(rawBody);
    } catch (error) {
      return badPayloadResponse(error);
    }
  } else {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook secret" },
        { status: 401 },
      );
    }

    try {
      payload = await readPayload(request);
    } catch (error) {
      return badPayloadResponse(error);
    }
  }

  const rawPayload = await enrichPayload(payload);
  const parsedAlert = normalizeAlert(rawPayload);
  const disallowedRecipientResponse = rejectDisallowedRecipient(parsedAlert);
  if (disallowedRecipientResponse) {
    return disallowedRecipientResponse;
  }
  logParseDiagnostic(rawPayload, parsedAlert);
  const heuristicScore = scoreAlert(parsedAlert);

  if (!hasDatabaseUrl()) {
    const decision = await triageIncomingAlert({
      alert: parsedAlert,
      rawPayload,
      heuristicScore,
      context: demoAssignmentContext(),
    });
    const alertFingerprint = fingerprint(
      {
        ...parsedAlert,
        subject: decision.title,
        bodyText: decision.summary,
        service: decision.service,
        severity: decision.severity,
        createdFrom: decision.createdFrom,
      },
      decision.dedupHint,
    );
    const ticket = await createTicket({
      title: decision.title,
      description: decision.summary,
      priority: decision.priority,
      reporterEmail: parsedAlert.senderEmail,
      assignedTeamId: decision.assignedTeamId || null,
      assignedUserId: decision.assignedUserId || null,
      createdFrom: decision.createdFrom,
      comment: `Demo webhook intake from ${parsedAlert.source}. ${decision.reasoning}`,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: "demo",
        alertId: `demo-alert-${Date.now()}`,
        incidentId: null,
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        priority: decision.priority,
        assignedTeamId: decision.assignedTeamId,
        assignedUserId: decision.assignedUserId,
        createdFrom: decision.createdFrom,
        recipientEmail: parsedAlert.recipientEmail,
        fingerprint: alertFingerprint,
        ai: {
          usedAi: decision.usedAi,
          model: decision.model,
          confidence: decision.confidence,
          fallbackReason: decision.fallbackReason,
        },
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
  const decision = await triageIncomingAlert({
    alert: parsedAlert,
    rawPayload,
    heuristicScore,
    context: await assignmentContext(orgId),
  });
  const alert: NormalizedAlert = {
    ...parsedAlert,
    subject: decision.title,
    bodyText: decision.summary,
    service: decision.service,
    severity: decision.severity,
    createdFrom: decision.createdFrom,
  };
  const score = {
    priority: decision.priority,
    importanceScore: decision.importanceScore,
    urgencyScore: decision.urgencyScore,
  };
  const alertFingerprint = fingerprint(alert, decision.dedupHint);

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
    select
      id,
      ticket_number::text,
      assigned_team_id::text,
      assigned_user_id::text
    from tickets
    where incident_id = ${incidentId}
      and status not in ('resolved', 'closed')
    order by updated_at desc
    limit 1
  `) as TicketIdRow[];

  const existingTicket = existingTicketRows[0] ?? null;
  let ticketId = existingTicket?.id ? String(existingTicket.id) : null;
  let ticketNumber = existingTicket?.ticket_number
    ? String(existingTicket.ticket_number)
    : null;
  let reassignedExistingTicket = false;

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

    const shouldReassign =
      !existingTicket?.assigned_team_id ||
      !existingTicket.assigned_user_id ||
      decision.confidence >= 0.75;

    if (shouldReassign && decision.assignedTeamId && decision.assignedUserId) {
      await sql`
        update tickets
        set
          assigned_team_id = ${decision.assignedTeamId},
          assigned_user_id = ${decision.assignedUserId},
          status = case
            when status = 'new' then 'assigned'
            else status
          end
        where id = ${ticketId}
      `;
      reassignedExistingTicket =
        existingTicket?.assigned_team_id !== decision.assignedTeamId ||
        existingTicket?.assigned_user_id !== decision.assignedUserId;
    }

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
        assigned_team_id,
        assigned_user_id,
        sla_due_at,
        reporter_email,
        created_from
      )
      values (
        ${orgId},
        ${incidentId},
        ${alert.subject},
        ${alert.bodyText},
        'assigned',
        ${score.priority},
        ${score.importanceScore},
        ${score.urgencyScore},
        ${decision.assignedTeamId || null},
        ${decision.assignedUserId || null},
        now() + (${slaMinutes(score.priority)} || ' minutes')::interval,
        ${alert.senderEmail},
        ${alert.createdFrom}
      )
      returning
        id,
        ticket_number::text,
        assigned_team_id::text,
        assigned_user_id::text
    `) as TicketIdRow[];
    ticketId = String(ticketRows[0].id);
    ticketNumber = String(ticketRows[0].ticket_number);
  }

  await writeAiTriageAudit({
    orgId,
    ticketId,
    decision,
    reassignedExistingTicket,
  });

  return NextResponse.json(
    {
      ok: true,
      alertId,
      incidentId,
      ticketId,
      ticketNumber,
      priority: score.priority,
      assignedTeamId: decision.assignedTeamId,
      assignedUserId: decision.assignedUserId,
      createdFrom: alert.createdFrom,
      recipientEmail: alert.recipientEmail,
      fingerprint: alertFingerprint,
      ai: {
        usedAi: decision.usedAi,
        model: decision.model,
        confidence: decision.confidence,
        fallbackReason: decision.fallbackReason,
      },
    },
    { status: 202 },
  );
}
