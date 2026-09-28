import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  triageIncomingAlert,
  type AssignmentContext,
  type AlertTriageDecision,
} from "@/lib/ai-triage";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { getDemoDashboardData } from "@/lib/demo-store";
import { persistCompletedTicketTriage } from "@/lib/jev-assessments";
import { ensureJevSchema } from "@/lib/jev-schema";
import { evaluateConfiguredRouting } from "@/lib/routing-policy";
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
        and u.role in ('agent','manager','admin')
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
        payload.message_id,
        payload.messageId,
        payload.MessageID,
        payload["Message-Id"],
        payload["Message-ID"],
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

async function writeJevTriageAudit({
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
      'jev.triaged',
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
        issueType: decision.issueType,
        urgency: decision.urgency,
        suggestedTeamId: decision.suggestedTeamId,
        needsHumanTriage: decision.needsHumanTriage,
        rubricVersion: decision.rubricVersion,
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
        jev: {
          usedAi: decision.usedAi,
          model: decision.model,
          confidence: decision.confidence,
          fallbackReason: decision.fallbackReason,
          issueType: decision.issueType,
          urgency: decision.urgency,
          needsHumanTriage: decision.needsHumanTriage,
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
  await ensureJevSchema();
  // The separate receipt ledger does not alter or delete historical alert records.
  await sql`create table if not exists inbound_webhook_receipts (
    org_id uuid not null references orgs(id) on delete cascade,
    source text not null, external_id text not null, claim_token uuid not null,
    lease_until timestamptz not null, response jsonb, completed_at timestamptz,
    created_at timestamptz not null default now(), primary key(org_id,source,external_id)
  )`;
  const externalId = parsedAlert.externalId || request.headers.get("svix-id") || randomUUID();
  const claimToken = randomUUID();
  const claims = await sql`
    insert into inbound_webhook_receipts(org_id,source,external_id,claim_token,lease_until)
    values (${orgId},${parsedAlert.source},${externalId},${claimToken},now()+interval '10 minutes')
    on conflict(org_id,source,external_id) do update
      set claim_token=excluded.claim_token,lease_until=excluded.lease_until
      where inbound_webhook_receipts.completed_at is null and inbound_webhook_receipts.lease_until < now()
    returning claim_token::text
  `;
  if (!claims.length) {
    const receipts = await sql`select response from inbound_webhook_receipts
      where org_id=${orgId} and source=${parsedAlert.source} and external_id=${externalId}`;
    if (isRecord(receipts[0]?.response)) {
      return NextResponse.json({...receipts[0].response, duplicate:true}, {status:202});
    }
    return NextResponse.json({ok:false,error:"This delivery is already being processed; retry shortly"},
      {status:503,headers:{"retry-after":"30"}});
  }
  try {
    // Lazily recognize old successful deliveries without destructive deduplication.
    if (parsedAlert.externalId) {
      const legacy = await sql`
        select a.id::text as alert_id,i.id::text as incident_id,t.id::text as ticket_id,
          t.ticket_number::text,t.priority
        from alert_events a join incident_alert_links l on l.alert_event_id=a.id
        join incidents i on i.id=l.incident_id join tickets t on t.incident_id=i.id
        where a.org_id=${orgId} and a.source=${parsedAlert.source} and a.external_id=${parsedAlert.externalId}
        order by a.created_at,t.created_at limit 1
      `;
      if (legacy[0]) {
        const prior=legacy[0];
        const response={ok:true,duplicate:true,alertId:prior.alert_id,incidentId:prior.incident_id,
          ticketId:prior.ticket_id,ticketNumber:prior.ticket_number,priority:prior.priority};
        await sql`update inbound_webhook_receipts set response=${JSON.stringify(response)}::jsonb,completed_at=now()
          where org_id=${orgId} and source=${parsedAlert.source} and external_id=${externalId} and claim_token=${claimToken}::uuid`;
        return NextResponse.json(response,{status:202});
      }
    }
    const context = await assignmentContext(orgId);
    let decision = await triageIncomingAlert({alert:parsedAlert,rawPayload,heuristicScore,context});
    const policy=await evaluateConfiguredRouting(orgId,
      {issueType:decision.issueType,urgency:decision.urgency,source:parsedAlert.createdFrom,needsHuman:decision.needsHumanTriage,confidence:decision.confidence},
      {priority:decision.priority,slaMinutes:slaMinutes(decision.priority),teamId:decision.assignedTeamId || null});
    if(!decision.needsHumanTriage) {
      const members=context.users.filter(user=>user.teamIds.includes(policy.teamId ?? ""));
      const onCall=members.filter(user=>user.isOnCall);
      const owner=[...(onCall.length ? onCall : members)].sort((a,b)=>a.openTickets-b.openTickets || (a.fullName??a.email).localeCompare(b.fullName??b.email))[0];
      decision={...decision,priority:policy.priority,assignedTeamId:policy.teamId ?? "",assignedUserId:owner?.id ?? "",
        reasoning:policy.ruleName ? "Configured routing policy: "+policy.ruleName : decision.reasoning};
    }
    const alert: NormalizedAlert = {...parsedAlert,subject:decision.title,bodyText:decision.summary,
      service:decision.service,severity:decision.severity,createdFrom:decision.createdFrom};
    const alertFingerprint = fingerprint(alert,decision.dedupHint);
    const responseBase = {ok:true,createdFrom:alert.createdFrom,recipientEmail:alert.recipientEmail,fingerprint:alertFingerprint,
      configuredRuleId:policy.ruleId,configuredRuleName:policy.ruleName,
      jev:{usedAi:decision.usedAi,model:decision.model,confidence:decision.confidence,fallbackReason:decision.fallbackReason,
        issueType:decision.issueType,urgency:decision.urgency,needsHumanTriage:decision.needsHumanTriage}};
    // All intake mutations and receipt completion commit atomically.
    const writes=await sql`
      with owned as materialized (
        select * from inbound_webhook_receipts where org_id=${orgId} and source=${parsedAlert.source}
          and external_id=${externalId} and claim_token=${claimToken}::uuid and completed_at is null for update
      ), existing_incident as materialized (
        select i.id from incidents i cross join owned where i.org_id=${orgId} and i.dedup_key=${alertFingerprint}
          and i.status in ('open','monitoring') order by i.last_seen_at desc limit 1
      ), new_incident as (
        insert into incidents(org_id,title,status,dedup_key,importance_score,urgency_score,priority,confidence,first_seen_at,last_seen_at,blast_count)
        select ${orgId},${alert.subject},'open',${alertFingerprint},${decision.importanceScore},${decision.urgencyScore},
          ${decision.priority},${decision.confidence},now(),now(),1 from owned where not exists(select 1 from existing_incident)
        returning id
      ), changed_incident as (
        update incidents i set last_seen_at=now(),blast_count=blast_count+1,
          urgency_score=greatest(urgency_score,${decision.urgencyScore}),
          importance_score=greatest(importance_score,${decision.importanceScore}),priority=least(priority,${decision.priority})::text,updated_at=now()
        from existing_incident e where i.id=e.id returning i.id
      ), selected_incident as (
        select id from new_incident union all select id from changed_incident
      ), new_alert as (
        insert into alert_events(org_id,source,external_id,sender_email,subject,body_text,raw_payload,fingerprint)
        select ${orgId},${alert.source},${parsedAlert.externalId ?? request.headers.get("svix-id")},${alert.senderEmail},
          ${alert.subject},${alert.bodyText},${JSON.stringify(rawPayload)}::jsonb,${alertFingerprint} from owned returning id
      ), linked_alert as (
        insert into incident_alert_links(incident_id,alert_event_id)
        select i.id,a.id from selected_incident i cross join new_alert a
      ), existing_ticket as materialized (
        select t.id,exists(select 1 from audit_logs a where a.entity_id=t.id
          and a.action='ticket.updated' and a.metadata ? 'priority') as human_priority_override
        from tickets t join selected_incident i on i.id=t.incident_id
        where t.status not in ('resolved','closed') order by t.updated_at desc limit 1
      ), changed_ticket as (
        update tickets t set updated_at=now(),priority=case when e.human_priority_override then priority else least(priority,${decision.priority})::text end,
          urgency_score=case when e.human_priority_override then urgency_score else greatest(urgency_score,${decision.urgencyScore}) end,
          importance_score=case when e.human_priority_override then importance_score else greatest(importance_score,${decision.importanceScore}) end,
          sla_due_at=least(sla_due_at,created_at+(${policy.slaMinutes} || ' minutes')::interval),
          response_due_at=least(response_due_at,created_at+(${policy.slaMinutes} || ' minutes')::interval)
        from existing_ticket e where t.id=e.id
        returning t.id,t.ticket_number,t.incident_id,t.org_id,t.status,t.priority,t.assigned_team_id,t.assigned_user_id
      ), new_ticket as (
        insert into tickets(org_id,incident_id,title,description,status,priority,importance_score,urgency_score,
          assigned_team_id,assigned_user_id,sla_due_at,response_due_at,reporter_email,created_from)
        select ${orgId},i.id,${alert.subject},${alert.bodyText},${decision.needsHumanTriage ? "triaged" : "assigned"},
          ${decision.priority},${decision.importanceScore},${decision.urgencyScore},
          ${decision.assignedTeamId || null}::uuid,${decision.assignedUserId || null}::uuid,
          now()+(${policy.slaMinutes} || ' minutes')::interval,now()+(${policy.slaMinutes} || ' minutes')::interval,
          ${alert.senderEmail},${alert.createdFrom}
        from selected_incident i where not exists(select 1 from existing_ticket)
        returning id,ticket_number,incident_id,org_id,status,priority,assigned_team_id,assigned_user_id
      ), selected_ticket as (
        select * from new_ticket union all select * from changed_ticket
      ), initial_event as (
        insert into ticket_status_events(org_id,ticket_id,from_status,to_status,completion_cycle,source,metadata)
        select org_id,id,null,status,0,'intake','{}'::jsonb from new_ticket
      ), customer_comment as (
        insert into ticket_comments(ticket_id,author_email,body,created_via)
        select id,${alert.senderEmail},${alert.bodyText},'email' from changed_ticket
        where ${alert.createdFrom === "client_email" && Boolean(alert.bodyText)}
      ), completed_receipt as (
        update inbound_webhook_receipts r set completed_at=now(),
          response=${JSON.stringify(responseBase)}::jsonb || jsonb_build_object(
            'alertId',a.id::text,'incidentId',t.incident_id::text,'ticketId',t.id::text,
            'ticketNumber',t.ticket_number::text,'priority',t.priority,'assignedTeamId',t.assigned_team_id::text,
            'assignedUserId',t.assigned_user_id::text)
        from selected_ticket t cross join new_alert a
        where r.org_id=${orgId} and r.source=${parsedAlert.source} and r.external_id=${externalId}
          and r.claim_token=${claimToken}::uuid returning r.response
      ) select response from completed_receipt
    `;
    const response = writes[0]?.response;
    if (!isRecord(response) || typeof response.ticketId !== "string") throw new Error("Delivery claim expired");
    const ticketId=response.ticketId;
    const assignedTeamId=typeof response.assignedTeamId==="string" ? response.assignedTeamId : null;
    const assignedUserId=typeof response.assignedUserId==="string" ? response.assignedUserId : null;
    try {
      await persistCompletedTicketTriage({orgId,ticketId,idempotencyKey:`triage:${ticketId}:${String(response.alertId)}:${decision.rubricVersion}`,
        ticket:{title:alert.subject,description:alert.bodyText,source:alert.source,service:alert.service,severity:alert.severity},
        teams:context.teams.map(team=>({id:team.id,name:team.name,description:`${team.name} support queue`})),
        fallbackPriority:heuristicScore.priority,result:decision.jevResult,
        routing:{priority:response.priority as Priority,assignedTeamId,assignedUserId,
          needsHumanTriage:assignedTeamId || assignedUserId ? false : decision.needsHumanTriage}});
    } catch {
      console.warn("jev_triage_persistence_failed",{ticketId});
    }
    await writeJevTriageAudit({orgId,ticketId,decision:{...decision,assignedTeamId:assignedTeamId ?? "",assignedUserId:assignedUserId ?? ""},
      reassignedExistingTicket:false});
    return NextResponse.json(response,{status:202});
  } catch {
    // A failed atomic intake has no partial ticket; release its lease for a safe retry.
    await sql`update inbound_webhook_receipts set lease_until=now()-interval '1 second'
      where org_id=${orgId} and source=${parsedAlert.source} and external_id=${externalId}
        and claim_token=${claimToken}::uuid and completed_at is null`;
    return NextResponse.json({ok:false,error:"Unable to finish this delivery; retry shortly"},
      {status:503,headers:{"retry-after":"30"}});
  }
}
