import { bindRepairShoprAccount, ensureRepairShoprWorkflowSchema, fetchRepairShoprHistory, mapRepairShoprUser, record, runRepairShoprImportBatch, timestamp } from "./repairshopr-workflow";
import { randomUUID } from "node:crypto";
import { getSql, hasDatabaseUrl } from "./db";
import {
  createCompletionAssessment,
  enqueueTicketTriage,
} from "./jev-assessments";
import { ensureJevSchema } from "./jev-schema";
import type { Priority, TicketStatus } from "./types";

type IdRow = { id: string };
type SyncRunRow = {
  status: "running" | "success" | "error";
  finished_at: string | null;
  error: string | null;
  cursor_updated_at: string | null;
};
type SyncLockRow = { lock_token: string };
type SchemaReadyRow = { ready: boolean };

export type RepairShoprConfig = {
  configured: boolean;
  subdomain: string | null;
  apiKeyPresent: boolean;
  syncSecretPresent: boolean;
  cronSecretPresent: boolean;
  baseUrl: string | null;
};

export type RepairShoprStatus = {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastStatus: "running" | "success" | "error" | "not_configured";
  lastError: string | null;
};

export type RepairShoprCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
};

export type RepairShoprTicket = {
  id: string;
  number: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  repairshoprStatus: string | null;
  priority: Priority;
  customerId: string | null;
  customerEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  raw: Record<string, unknown>;
};

export type RepairShoprSyncResult = {
  ok: true;
  customersSynced: number;
  ticketsSynced: number;
  cursorUpdatedAt: string | null;
};

const activeStatuses = new Set([
  "new",
  "not closed",
  "open",
  "customer reply",
  "scheduled",
  "waiting for parts",
  "waiting on customer",
  "in progress",
]);

let repairShoprSchemaPromise: Promise<void> | null = null;
let repairShoprAuthPreference: {
  cacheKey: string;
  mode: "header" | "query";
} | null = null;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return cleanString(value);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listValue(payload: unknown, key: string) {
  if (Array.isArray(payload)) return payload;
  const object = objectValue(payload);
  if (!object) return [];
  const nested = object[key];
  if (Array.isArray(nested)) return nested;
  if (Array.isArray(object.data)) return object.data;
  if (Array.isArray(object.results)) return object.results;
  return [];
}

function dateOrNull(value: unknown) {
  const text = cleanString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function firstCommentText(value: unknown) {
  if (!Array.isArray(value)) return null;

  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    const comment = objectValue(entry);
    if (!comment) continue;
    const text = firstString(comment, ["body", "comment", "content", "text", "subject"]);
    if (text) return text;
  }

  return null;
}

function nestedString(
  record: Record<string, unknown>,
  parentKeys: string[],
  childKeys: string[],
) {
  for (const parentKey of parentKeys) {
    const parent = objectValue(record[parentKey]);
    if (!parent) continue;
    const value = firstString(parent, childKeys);
    if (value) return value;
  }
  return null;
}

function scorePriority(text: string): Priority {
  const haystack = text.toLowerCase();
  if (/\b(p1|critical|emergency|down|outage|cannot work|asap|urgent)\b/.test(haystack)) {
    return "P1";
  }
  if (/\b(p2|high|blocked|broken|failed|failure|payment|checkout)\b/.test(haystack)) {
    return "P2";
  }
  if (/\b(low|cosmetic|question|quote)\b/.test(haystack)) {
    return "P4";
  }
  return "P3";
}

export function normalizeRepairShoprStatus(status: unknown): TicketStatus {
  const value = cleanString(status).toLowerCase().replace(/[_-]+/g, " ");

  if (!value) return "triaged";
  if (value === "not closed") return "triaged";
  if (value.includes("resolved")) return "resolved";
  if (value.includes("closed") || value.includes("invoiced")) return "closed";
  if (value.includes("waiting")) return "waiting";
  if (value.includes("progress")) return "in_progress";
  if (value.includes("scheduled") || value.includes("assigned")) return "assigned";
  if (value === "new") return "new";
  if (activeStatuses.has(value)) return "triaged";
  return "triaged";
}

export function getRepairShoprConfig(): RepairShoprConfig {
  const configuredSubdomain = process.env.REPAIRSHOPR_SUBDOMAIN?.trim() ?? "";
  const subdomain = configuredSubdomain
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.repairshopr\.com$/i, "")
    .toLowerCase();
  const apiKey = process.env.REPAIRSHOPR_API_KEY?.trim() ?? "";
  const validSubdomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
    subdomain,
  );
  const baseUrl = validSubdomain
    ? `https://${subdomain}.repairshopr.com/api/v1`
    : null;

  return {
    configured: Boolean(validSubdomain && apiKey),
    subdomain: validSubdomain ? subdomain : null,
    apiKeyPresent: Boolean(apiKey),
    syncSecretPresent: Boolean(process.env.REPAIRSHOPR_SYNC_SECRET?.trim()),
    cronSecretPresent: Boolean(process.env.CRON_SECRET?.trim()),
    baseUrl,
  };
}

function secretsMatch(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function isRepairShoprRequestAuthorized(request: Request) {
  const configuredSecrets = [
    process.env.REPAIRSHOPR_SYNC_SECRET?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((secret): secret is string => Boolean(secret));
  if (configuredSecrets.length === 0) return false;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearerSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const headerSecret =
    request.headers.get("x-repairshopr-sync-secret")?.trim() ??
    request.headers.get("x-sync-secret")?.trim() ??
    "";
  const presentedSecrets = [bearerSecret, headerSecret].filter(Boolean);

  return configuredSecrets.some((configuredSecret) =>
    presentedSecrets.some((presentedSecret) =>
      secretsMatch(configuredSecret, presentedSecret),
    ),
  );
}

export function normalizeRepairShoprCustomer(
  value: unknown,
): RepairShoprCustomer | null {
  const customer = objectValue(value);
  if (!customer) return null;

  const id = firstString(customer, ["id", "customer_id", "customerId"]);
  if (!id) return null;

  const firstName = firstString(customer, ["firstname", "first_name", "firstName"]);
  const lastName = firstString(customer, ["lastname", "last_name", "lastName"]);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ");
  const name =
    firstString(customer, ["business_name", "businessName", "name", "fullname", "full_name"]) ??
    (combinedName || null);

  return {
    id,
    name,
    email: firstString(customer, ["email", "email_address", "emailAddress"]),
    phone: firstString(customer, ["phone", "mobile", "phone_number", "phoneNumber"]),
    updatedAt: dateOrNull(
      customer.updated_at ?? customer.updatedAt ?? customer.modified_at,
    ),
    raw: customer,
  };
}

export function normalizeRepairShoprTicket(
  value: unknown,
  baseUrl?: string | null,
): RepairShoprTicket | null {
  const ticket = objectValue(value);
  if (!ticket) return null;

  const id = firstString(ticket, ["id", "ticket_id", "ticketId"]);
  if (!id) return null;

  const number = firstString(ticket, ["number", "ticket_number", "ticketNumber"]);
  const problemType = firstString(ticket, ["problem_type", "problemType"]);
  const subject =
    firstString(ticket, ["subject", "title", "summary"]) ??
    problemType ??
    `RepairShopr ticket ${number ?? id}`;
  const description =
    firstString(ticket, ["description", "issue", "diagnosis", "notes"]) ??
    firstCommentText(ticket.comments) ??
    firstString(ticket, ["initial_issue", "initialIssue"]) ??
    (problemType && problemType !== subject ? problemType : null);
  const repairshoprStatus = firstString(ticket, ["status", "status_name", "statusName"]);
  const customerId =
    firstString(ticket, ["customer_id", "customerId"]) ??
    nestedString(ticket, ["customer"], ["id", "customer_id", "customerId"]);
  const customerEmail =
    firstString(ticket, ["customer_email", "email", "contact_email"]) ??
    nestedString(ticket, ["customer", "contact"], ["email", "email_address"]);
  const updatedAt = dateOrNull(
    ticket.updated_at ?? ticket.updatedAt ?? ticket.modified_at ?? ticket.last_updated_at,
  );
  const createdAt = dateOrNull(ticket.created_at ?? ticket.createdAt);
  const priority = scorePriority(
    [subject, description, repairshoprStatus, firstString(ticket, ["priority"])].join(" "),
  );

  return {
    id,
    number,
    title: subject.slice(0, 180),
    description,
    status: normalizeRepairShoprStatus(repairshoprStatus),
    repairshoprStatus,
    priority,
    customerId,
    customerEmail,
    createdAt,
    updatedAt,
    url: baseUrl ? `${baseUrl.replace(/\/api\/v1$/, "")}/tickets/${id}` : null,
    raw: ticket,
  };
}

export function extractRepairShoprCustomers(payload: unknown) {
  return listValue(payload, "customers")
    .map(normalizeRepairShoprCustomer)
    .filter((customer): customer is RepairShoprCustomer => Boolean(customer));
}

export function extractRepairShoprTickets(payload: unknown, baseUrl?: string | null) {
  return listValue(payload, "tickets")
    .map((ticket) => normalizeRepairShoprTicket(ticket, baseUrl))
    .filter((ticket): ticket is RepairShoprTicket => Boolean(ticket));
}

async function applyRepairShoprSchema() {
  const sql = getSql();

  await sql`alter table tickets add column if not exists repairshopr_ticket_id text`;
  await sql`alter table tickets add column if not exists repairshopr_ticket_number text`;
  await sql`alter table tickets add column if not exists repairshopr_customer_id text`;
  await sql`alter table tickets add column if not exists repairshopr_status text`;
  await sql`alter table tickets add column if not exists repairshopr_url text`;
  await sql`alter table tickets add column if not exists repairshopr_updated_at timestamptz`;
  await sql`alter table tickets add column if not exists repairshopr_payload jsonb`;

  await sql`
    create table if not exists repairshopr_customers (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references orgs(id) on delete cascade,
      repairshopr_customer_id text not null,
      name text,
      email text,
      phone text,
      remote_updated_at timestamptz,
      raw_payload jsonb not null,
      last_synced_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(org_id, repairshopr_customer_id)
    )
  `;

  await sql`
    create table if not exists repairshopr_sync_runs (
      id uuid primary key default gen_random_uuid(),
      org_id uuid references orgs(id) on delete cascade,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      status text not null check (status in ('running','success','error')),
      customers_synced int not null default 0,
      tickets_synced int not null default 0,
      error text,
      cursor_updated_at timestamptz
    )
  `;
  await sql`
    create table if not exists repairshopr_sync_locks (
      org_id uuid primary key references orgs(id) on delete cascade,
      lock_token uuid not null,
      acquired_at timestamptz not null default now(),
      expires_at timestamptz not null
    )
  `;

  await sql`
    create unique index if not exists tickets_org_repairshopr_ticket_idx
    on tickets(org_id, repairshopr_ticket_id)
    where repairshopr_ticket_id is not null
  `;
  await sql`
    create index if not exists tickets_org_repairshopr_customer_idx
    on tickets(org_id, repairshopr_customer_id)
    where repairshopr_customer_id is not null
  `;
  await sql`
    create index if not exists repairshopr_sync_runs_started_idx
    on repairshopr_sync_runs(started_at desc)
  `;
  await sql`
    drop trigger if exists repairshopr_customers_touch_updated_at
    on repairshopr_customers
  `;
  await sql`
    create trigger repairshopr_customers_touch_updated_at
    before update on repairshopr_customers
    for each row execute function touch_updated_at()
  `;
}

async function isRepairShoprSchemaReady() {
  const sql = getSql();
  const rows = (await sql`
    select (
      (
        select count(*) = 7
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'tickets'
          and column_name in (
            'repairshopr_ticket_id',
            'repairshopr_ticket_number',
            'repairshopr_customer_id',
            'repairshopr_status',
            'repairshopr_url',
            'repairshopr_updated_at',
            'repairshopr_payload'
          )
      )
      and to_regclass('repairshopr_customers') is not null
      and to_regclass('repairshopr_sync_runs') is not null
      and to_regclass('repairshopr_sync_locks') is not null
      and exists (
        select 1
        from pg_trigger
        where tgrelid = to_regclass('repairshopr_customers')
          and tgname = 'repairshopr_customers_touch_updated_at'
          and not tgisinternal
      )
    ) as ready
  `) as SchemaReadyRow[];

  return Boolean(rows[0]?.ready);
}

async function initializeRepairShoprSchema() {
  if (await isRepairShoprSchemaReady()) return;
  await applyRepairShoprSchema();
}

export async function ensureRepairShoprSchema() {
  if (!hasDatabaseUrl()) return;

  repairShoprSchemaPromise ??= initializeRepairShoprSchema();
  try {
    await repairShoprSchemaPromise;
  } catch (error) {
    repairShoprSchemaPromise = null;
    throw error;
  }
}

async function ensureDefaultOrg() {
  const sql = getSql();
  const rows = (await sql`
    insert into orgs (name)
    values ('Default Operations')
    on conflict (name) do update set name = excluded.name
    returning id
  `) as IdRow[];

  return rows[0].id;
}


async function repairShoprFetch(path: string, params: Record<string, string>) {
  const config = getRepairShoprConfig();
  if (!config.configured || !config.baseUrl) {
    throw new Error("RepairShopr is not configured");
  }

  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const apiKey = process.env.REPAIRSHOPR_API_KEY?.trim() ?? "";
  const queryApiKey = apiKey.replace(/^Bearer\s+/i, "");
  const authCacheKey = `${config.baseUrl}:${apiKey}`;
  if (repairShoprAuthPreference?.cacheKey !== authCacheKey) {
    repairShoprAuthPreference = null;
  }
  const configuredTimeout = Number.parseInt(
    process.env.REPAIRSHOPR_FETCH_TIMEOUT_MS ?? "15000",
    10,
  );
  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, Number.isFinite(configuredTimeout) ? configuredTimeout : 15_000),
  );

  async function requestWithAuth(mode: "header" | "query") {
    await new Promise(resolve => setTimeout(resolve, 350));
    const requestUrl = new URL(url);
    const headers: Record<string, string> = { accept: "application/json" };
    if (mode === "header") {
      headers.authorization = `Bearer ${queryApiKey}`;
    } else {
      requestUrl.searchParams.set("api_key", queryApiKey);
    }

    try {
      return await fetch(requestUrl, {
        headers,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "request timed out" : "network request failed";
      throw new Error(`RepairShopr ${path} request failed: ${reason}`);
    }
  }

  let authMode = repairShoprAuthPreference?.mode ?? "header";
  let response = await requestWithAuth(authMode);
  if (
    authMode === "header" &&
    (response.status === 401 || response.status === 403)
  ) {
    authMode = "query";
    response = await requestWithAuth(authMode);
  }

  if (!response.ok) {
    throw new Error(`RepairShopr ${path} failed (${response.status})`);
  }

  repairShoprAuthPreference = { cacheKey: authCacheKey, mode: authMode };

  return response.json() as Promise<unknown>;
}



async function upsertCustomer(orgId: string, customer: RepairShoprCustomer) {
  const sql = getSql();
  await sql`
    insert into repairshopr_customers (
      org_id,
      repairshopr_customer_id,
      name,
      email,
      phone,
      remote_updated_at,
      raw_payload,
      last_synced_at
    )
    values (
      ${orgId},
      ${customer.id},
      ${customer.name},
      ${customer.email},
      ${customer.phone},
      ${customer.updatedAt},
      ${JSON.stringify(customer.raw)}::jsonb,
      now()
    )
    on conflict (org_id, repairshopr_customer_id) do update
      set name = excluded.name,
          email = excluded.email,
          phone = excluded.phone,
          remote_updated_at = excluded.remote_updated_at,
          raw_payload = excluded.raw_payload,
          last_synced_at = now()
  `;
}

async function upsertTicket(orgId: string, ticket: RepairShoprTicket) {
  const sql = getSql();
  const customer = normalizeRepairShoprCustomer(ticket.raw.customer);
  if (customer) await upsertCustomer(orgId, customer);
  const history = await fetchRepairShoprHistory(ticket.id, repairShoprFetch);
  const technicianId = await mapRepairShoprUser(orgId, ticket.raw.user_id, repairShoprFetch);
  const rows = await sql`select id::text,status,completion_cycle from tickets where org_id=${orgId} and repairshopr_ticket_id=${ticket.id}`;
  const existing = rows[0];
  const id = existing ? String(existing.id) : randomUUID();
  const complete = ["resolved","closed"].includes(ticket.status);
  const wasComplete = existing && ["resolved","closed"].includes(String(existing.status));
  const completing = complete && !wasComplete;
  const reopening = Boolean(wasComplete && !complete);
  const cycle = Number(existing?.completion_cycle ?? 0) + (completing ? 1 : 0);
  const resolvedAt = complete ? timestamp(ticket.raw.resolved_at) : null;
  // Historical ownership is not evidence of who completed the work.
  let evaluatedUser = existing && completing ? technicianId : null;
  if (complete && wasComplete) {
    const prior = await sql`select metadata from ticket_status_events where ticket_id=${id} and completion_cycle=${cycle}
      and to_status in ('resolved','closed') order by changed_at desc limit 1`;
    const attribution = record(prior[0]?.metadata).technicianUserId;
    evaluatedUser = typeof attribution === "string" ? attribution : null;
  }
  const publicReply = history.find(entry => entry.action === "customer-facing technician message" && (!ticket.createdAt || entry.at >= ticket.createdAt));
  const metadata = { repairshoprTicketId: ticket.id, reopening, technicianUserId: evaluatedUser,
    attributionSource: existing ? "repairshopr_assignee_at_observed_completion" : "historical_import_unattributed" };
  await sql.transaction([
    sql`insert into tickets(id,org_id,title,description,status,priority,importance_score,urgency_score,reporter_email,created_from,created_at,
      assigned_user_id,repairshopr_ticket_id,repairshopr_ticket_number,repairshopr_customer_id,repairshopr_status,repairshopr_url,repairshopr_updated_at,repairshopr_payload,
      repairshopr_evidence,completion_cycle,reopened_count,resolved_at,first_response_at,sla_due_at)
      values (${id},${orgId},${ticket.title},${ticket.description},${ticket.status},${ticket.priority},20,18,
      coalesce(${ticket.customerEmail},(select email from repairshopr_customers where org_id=${orgId} and repairshopr_customer_id=${ticket.customerId} limit 1)),
      'repairshopr',coalesce(${ticket.createdAt}::timestamptz,now()),${technicianId},
      ${ticket.id},${ticket.number},${ticket.customerId},${ticket.repairshoprStatus},${ticket.url},${ticket.updatedAt},${JSON.stringify(ticket.raw)}::jsonb,
      ${JSON.stringify(history)}::jsonb,${cycle},0,${resolvedAt}::timestamptz,${publicReply?.at ?? null}::timestamptz,${timestamp(ticket.raw.due_date)}::timestamptz)
      on conflict(org_id,repairshopr_ticket_id) where repairshopr_ticket_id is not null do update set
      title=excluded.title,description=excluded.description,status=excluded.status,assigned_user_id=excluded.assigned_user_id,
      reporter_email=excluded.reporter_email,repairshopr_ticket_number=excluded.repairshopr_ticket_number,
      repairshopr_customer_id=excluded.repairshopr_customer_id,repairshopr_status=excluded.repairshopr_status,
      repairshopr_url=excluded.repairshopr_url,repairshopr_updated_at=excluded.repairshopr_updated_at,
      repairshopr_payload=excluded.repairshopr_payload,repairshopr_evidence=excluded.repairshopr_evidence,
      completion_cycle=${cycle},reopened_count=tickets.reopened_count+${reopening ? 1 : 0},
      resolved_at=case when ${complete} then coalesce(excluded.resolved_at,tickets.resolved_at,now()) else null end,
      first_response_at=excluded.first_response_at,sla_due_at=coalesce(excluded.sla_due_at,tickets.sla_due_at)`,
    sql`insert into ticket_status_events(org_id,ticket_id,from_status,to_status,completion_cycle,source,metadata,changed_at)
      select ${orgId},${id},${existing?.status ?? null},${ticket.status},${cycle},'repairshopr',${JSON.stringify(metadata)}::jsonb,
        coalesce(${completing ? resolvedAt : ticket.updatedAt}::timestamptz,now())
      where ${!existing || existing.status !== ticket.status}`,
  ]);
  // Idempotent enqueue also repairs a crash between the committed import and the job enqueue.
  await enqueueTicketTriage({ orgId, ticketId:id,
    ticket:{title:ticket.title,description:ticket.description,source:"repairshopr",service:"support_portal",severity:ticket.priority},
    fallbackPriority:ticket.priority,preserveAssignment:true,preservePriority:true,
    idempotencyKey:`triage:${id}:repairshopr:${ticket.id}` });
  if (complete) {
    const assessments = await sql`select id from jev_assessments where ticket_id=${id} and kind='completion_review' and completion_cycle=${cycle} limit 1`;
    if (!assessments.length) {
      const events = await sql`select metadata from ticket_status_events where ticket_id=${id} and completion_cycle=${cycle}
        and to_status in ('resolved','closed') order by changed_at desc limit 1`;
      const saved = record(events[0]?.metadata);
      await createCompletionAssessment({orgId,ticketId:id,completionCycle:cycle,
        technicianUserId:typeof saved.technicianUserId === "string" ? saved.technicianUserId : null});
    }
  }
}

async function acquireSyncLock(orgId: string) {
  const sql = getSql();
  const lockToken = randomUUID();
  const rows = (await sql`
    insert into repairshopr_sync_locks (
      org_id,
      lock_token,
      acquired_at,
      expires_at
    )
    values (
      ${orgId},
      ${lockToken},
      now(),
      now() + interval '15 minutes'
    )
    on conflict (org_id) do update
      set lock_token = excluded.lock_token,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
      where repairshopr_sync_locks.expires_at <= now()
    returning lock_token::text
  `) as SyncLockRow[];

  if (!rows[0]) {
    throw new Error("A RepairShopr sync is already running");
  }

  return lockToken;
}

async function releaseSyncLock(orgId: string, lockToken: string) {
  const sql = getSql();
  await sql`
    delete from repairshopr_sync_locks
    where org_id = ${orgId} and lock_token = ${lockToken}::uuid
  `;
}

async function renewSyncLock(orgId: string, lockToken: string) {
  const sql = getSql();
  const rows = (await sql`
    update repairshopr_sync_locks
    set expires_at = now() + interval '15 minutes'
    where org_id = ${orgId}
      and lock_token = ${lockToken}::uuid
    returning lock_token::text
  `) as SyncLockRow[];

  if (!rows[0]) {
    throw new Error("The RepairShopr sync lock was lost");
  }
}

export async function getRepairShoprStatus(): Promise<RepairShoprStatus> {
  const config = getRepairShoprConfig();
  if (!config.configured || !hasDatabaseUrl()) {
    return {
      configured: config.configured,
      connected: false,
      lastSyncAt: null,
      lastStatus: config.configured ? "error" : "not_configured",
      lastError: !hasDatabaseUrl() ? "DATABASE_URL is not configured" : null,
    };
  }

  await ensureRepairShoprSchema();
  const sql = getSql();
  const rows = (await sql`
    select status, finished_at::text, error, cursor_updated_at::text
    from repairshopr_sync_runs
    order by started_at desc
    limit 1
  `) as SyncRunRow[];
  const latest = rows[0];

  return {
    configured: true,
    connected: latest?.status === "success",
    lastSyncAt: latest?.finished_at ?? null,
    lastStatus: latest?.status ?? "not_configured",
    lastError: latest?.error ?? null,
  };
}

export async function testRepairShoprConnection() {
  const config = getRepairShoprConfig();
  if (!config.configured) {
    throw new Error("RepairShopr subdomain and API key are required");
  }

  await repairShoprFetch("/customers", { page: "1" });
  const tickets = record(await repairShoprFetch("/tickets", { page: "1" }));
  await repairShoprFetch("/users", { page: "1" });
  const sample = Array.isArray(tickets.tickets) ? record(tickets.tickets[0]) : {};
  if (sample.id) {
    await repairShoprFetch(`/tickets/${sample.id}`, {});
    await repairShoprFetch(`/tickets/${sample.id}/comments`, { page: "1" });
    if (sample.user_id) await repairShoprFetch(`/users/${sample.user_id}`, {});
  }
  return { ok: true, baseUrl: config.baseUrl };
}

export async function syncRepairShopr(): Promise<RepairShoprSyncResult> {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }

  const config = getRepairShoprConfig();
  if (!config.configured || !config.baseUrl) {
    throw new Error("RepairShopr subdomain and API key are required");
  }

  await Promise.all([ensureRepairShoprSchema(), ensureJevSchema()]);
  await ensureRepairShoprWorkflowSchema();
  const sql = getSql();
  const orgId = await ensureDefaultOrg();
  // Do not bind an organization to a mistyped or unauthenticated account.
  await repairShoprFetch("/users", { page: "1" });
  await bindRepairShoprAccount(orgId, config.subdomain!);
  const lockToken = await acquireSyncLock(orgId);
  let runId: string | null = null;

  try {
    await sql`
      update repairshopr_sync_runs
      set status = 'error',
          finished_at = now(),
          error = 'Sync did not finish before its lock expired'
      where org_id = ${orgId}
        and status = 'running'
        and started_at < now() - interval '15 minutes'
    `;
    const runRows = (await sql`
      insert into repairshopr_sync_runs (org_id, status)
      values (${orgId}, 'running')
      returning id
    `) as IdRow[];
    runId = runRows[0].id;

    const batch = await runRepairShoprImportBatch({
      orgId, fetcher: repairShoprFetch, renew: () => renewSyncLock(orgId,lockToken),
      customer: async raw => { const customer=normalizeRepairShoprCustomer(raw); if (!customer) throw new Error("Invalid customer"); await upsertCustomer(orgId,customer); },
      ticket: async raw => { const ticket=normalizeRepairShoprTicket(raw,config.baseUrl); if (!ticket) throw new Error("Invalid ticket"); await upsertTicket(orgId,ticket); },
    });
    const { cursorUpdatedAt } = batch;

    await renewSyncLock(orgId, lockToken);
    await sql`
      update repairshopr_sync_runs
      set status = ${batch.failedTickets > 0 ? "error" : "success"},
          error = ${batch.failedTickets > 0 ? "Some ticket imports failed and remain queued for retry. Check readiness for backlog." : null},
          finished_at = now(),
          customers_synced = ${batch.customersSynced},
          tickets_synced = ${batch.ticketsSynced},
          cursor_updated_at = ${cursorUpdatedAt}
      where id = ${runId}
    `;

    return {
      ok: true,
      ...batch,
      cursorUpdatedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown RepairShopr sync error";
    if (runId) {
      await sql`
        update repairshopr_sync_runs
        set status = 'error',
            finished_at = now(),
            error = ${message}
        where id = ${runId}
      `;
    }
    throw error;
  } finally {
    await releaseSyncLock(orgId, lockToken).catch(() => undefined);
  }
}
