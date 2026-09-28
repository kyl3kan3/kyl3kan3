import { randomUUID } from "node:crypto";
import { getSql, hasDatabaseUrl } from "./db";
import type { Priority } from "./types";

export type TicketProvider = "repairshopr" | "syncro";
export type WritebackStatus = "awaiting_approval" | "pending" | "running" | "retryable" | "succeeded" | "conflict" | "blocked" | "failed" | "superseded";
type Json = Record<string, unknown>;
export type RoutingProposal = { priority: Priority; assignedUserId?: string | null; sourceUpdatedAt?: string | null };
type Payload = { priority: string; user_id?: number };
type QueueRow = {
  id: string; org_id: string; ticket_id: string; assessment_id: string; provider: TicketProvider;
  external_id: string; account_subdomain: string | null; status: WritebackStatus;
  desired: Payload; proposal: RoutingProposal; expected_source: Json; local_snapshot: Json;
  attempts: number; last_error: string | null; created_at: string; completed_at: string | null;
};
const providers: TicketProvider[] = ["repairshopr", "syncro"];
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const id = (value: unknown) => /^\d+$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(value) : null;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function getProviderWritebackConfig(provider: TicketProvider) {
  const prefix = provider.toUpperCase();
  const suffix = provider === "repairshopr" ? "repairshopr.com" : "syncromsp.com";
  const raw = process.env[`${prefix}_SUBDOMAIN`]?.trim().toLowerCase() ?? "";
  const subdomain = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(new RegExp(`\\.${suffix.replaceAll(".", "\\.")}$`), "");
  const valid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
  const enabled = process.env[`${prefix}_WRITEBACK_ENABLED`] === "true";
  let priorityMap: Partial<Record<Priority, string>> = {};
  try {
    const parsed = object(JSON.parse(process.env[`${prefix}_WRITEBACK_PRIORITY_MAP`] ?? "{}"));
    priorityMap = Object.fromEntries(["P1", "P2", "P3", "P4"].flatMap(key => typeof parsed[key] === "string" && String(parsed[key]).trim() && String(parsed[key]).length <= 100 ? [[key, String(parsed[key]).trim()]] : []));
  } catch { /* Invalid configuration is reported as missing mappings, never guessed. */ }
  const secureManagerAccess = process.env.NODE_ENV !== "production" || (process.env.MANAGER_DASHBOARD_PASSWORD?.trim().length ?? 0) >= 16;
  return { provider, enabled, autoApprove: enabled && process.env[`${prefix}_WRITEBACK_AUTO_APPROVE`] === "true",
    configured: valid && Boolean(process.env[`${prefix}_API_KEY`]?.trim()), subdomain: valid ? subdomain : null,
    baseUrl: valid ? `https://${subdomain}.${suffix}/api/v1` : null, priorityMap, secureManagerAccess };
}

let schema: Promise<void> | undefined;
export async function ensureProviderWritebackSchema() {
  schema ??= (async () => {
    const sql = getSql();
    await sql`create table if not exists provider_user_links (
      org_id uuid not null references orgs(id), provider text not null, external_id text not null,
      user_id uuid not null references users(id), primary key(org_id,provider,external_id))`;
    await sql`create table if not exists provider_writebacks (
      id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
      ticket_id uuid not null references tickets(id) on delete cascade,
      assessment_id uuid not null references jev_assessments(id) on delete cascade,
      provider text not null check(provider in ('repairshopr','syncro')), external_id text not null,
      account_subdomain text, status text not null check(status in ('awaiting_approval','pending','running','retryable','succeeded','conflict','blocked','failed','superseded')),
      proposal jsonb not null, desired jsonb not null, expected_source jsonb not null, local_snapshot jsonb not null,
      attempts int not null default 0, next_retry_at timestamptz, last_error text,
      approved_at timestamptz, started_at timestamptz, completed_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique(org_id,assessment_id))`;
    await sql`create index if not exists provider_writebacks_queue_idx on provider_writebacks(provider,status,next_retry_at,created_at)`;
    await sql`create table if not exists provider_writeback_locks (
      org_id uuid not null references orgs(id), provider text not null, token uuid not null, expires_at timestamptz not null,
      primary key(org_id,provider))`;
  })();
  try { await schema; } catch (error) { schema = undefined; throw error; }
}

async function ticketSnapshot(orgId: string, ticketId: string) {
  const rows = await getSql()`select to_jsonb(t) as ticket from tickets t where t.org_id=${orgId} and t.id=${ticketId}`;
  return rows[0] ? object(rows[0].ticket) : null;
}

async function mappedPayload(orgId: string, provider: TicketProvider, proposal: RoutingProposal): Promise<Payload> {
  const config = getProviderWritebackConfig(provider);
  const priority = config.priorityMap[proposal.priority];
  if (!priority) throw new Error(`missing_priority_mapping:${proposal.priority}`);
  const payload: Payload = { priority };
  if (proposal.assignedUserId) {
    const sql = getSql();
    let matches = await sql`select external_id from provider_user_links where org_id=${orgId} and provider=${provider} and user_id=${proposal.assignedUserId}`;
    if (!matches.length && provider === "repairshopr") {
      const exists = await sql`select to_regclass('repairshopr_user_links') is not null as ready`;
      if (exists[0]?.ready) matches = await sql`select external_id from repairshopr_user_links where org_id=${orgId} and user_id=${proposal.assignedUserId}`;
    }
    if (matches.length !== 1 || !id(matches[0]?.external_id)) throw new Error("missing_or_ambiguous_technician_mapping");
    payload.user_id = Number(matches[0].external_id);
  }
  // Provider due_date is a completion deadline, not our response SLA. Do not export sla_due_at.
  // Likewise there is no documented team/queue field in PUT /tickets/{id}; keep team routing local.
  return payload;
}

function sourceSnapshot(ticket: Json, provider: TicketProvider) {
  const raw = object(ticket[`${provider}_payload`]);
  return { updated_at: date(ticket[`${provider}_updated_at`]) ?? date(raw.updated_at),
    priority: raw.priority ?? null, user_id: id(raw.user_id), status: raw.status ?? null };
}
function localSnapshot(ticket: Json) { return { priority: ticket.priority, assigned_user_id: ticket.assigned_user_id ?? null, status: ticket.status }; }
function localUnchanged(ticket: Json, snapshot: Json) {
  return ticket.triage_needs_human === false && ticket.priority === snapshot.priority && (ticket.assigned_user_id ?? null) === snapshot.assigned_user_id && ticket.status === snapshot.status;
}

async function assessmentIsCurrent(orgId: string, ticketId: string, assessmentId: string) {
  const rows = await getSql()`select a.status='succeeded' and not exists(
    select 1 from jev_assessments newer where newer.org_id=a.org_id and newer.ticket_id=a.ticket_id and newer.kind='triage'
      and (newer.created_at,newer.id)>(a.created_at,a.id)) as current
    from jev_assessments a where a.org_id=${orgId} and a.ticket_id=${ticketId} and a.id=${assessmentId} and a.kind='triage'`;
  return rows[0]?.current === true;
}

async function assertAccountBinding(orgId: string, provider: TicketProvider, subdomain: string) {
  const sql = getSql();
  const table = provider === "repairshopr" ? "repairshopr_account_binding" : "syncro_account_binding";
  const ready = await sql`select to_regclass(${table}) is not null as ready`;
  if (!ready[0]?.ready) throw new Error("missing_verified_account_binding");
  const rows = provider === "repairshopr"
    ? await sql`select subdomain from repairshopr_account_binding where org_id=${orgId}`
    : await sql`select subdomain from syncro_account_binding where org_id=${orgId}`;
  if (rows[0]?.subdomain !== subdomain) throw new Error("provider_account_binding_mismatch");
}

/** A durable proposal is harmless until approved AND WRITEBACK_ENABLED is explicitly true. */
export async function enqueueRoutingWriteback(input: { orgId: string; ticketId: string; assessmentId: string; proposal?: RoutingProposal }) {
  await ensureProviderWritebackSchema();
  const sql = getSql();
  const existing = await sql`select id::text,status,last_error from provider_writebacks where org_id=${input.orgId} and assessment_id=${input.assessmentId}`;
  if (existing[0]) return { queued: true, id: String(existing[0].id), status: String(existing[0].status) as WritebackStatus };
  const ticket = await ticketSnapshot(input.orgId, input.ticketId);
  if (!ticket || !providers.includes(ticket.created_from as TicketProvider)) return { queued: false, reason: "not_a_provider_ticket" };
  const provider = ticket.created_from as TicketProvider;
  const externalId = id(ticket[`${provider}_ticket_id`]);
  if (!externalId) return { queued: false, reason: "invalid_source_identity" };
  const assessments = await sql`select status,kind,result from jev_assessments where id=${input.assessmentId} and org_id=${input.orgId} and ticket_id=${input.ticketId}`;
  const assessment = assessments[0];
  const result = object(assessment?.result), routing = object(result.routing);
  if (assessment?.status !== "succeeded" || assessment.kind !== "triage" || object(result.assessment).needsHumanTriage !== false || routing.needsHumanTriage !== false || ticket.triage_needs_human !== false) {
    return { queued: false, reason: "assessment_requires_human_triage" };
  }
  if (["resolved", "closed"].includes(String(ticket.status))) return { queued: false, reason: "ticket_already_completed" };
  const proposal = input.proposal ?? { priority: ticket.priority as Priority, assignedUserId: ticket.assigned_user_id as string | null };
  const config = getProviderWritebackConfig(provider);
  let desired: Partial<Payload> = {}, error: string | null = null;
  const expected = sourceSnapshot(ticket, provider);
  try {
    if (!expected.updated_at) throw new Error("missing_source_version");
    if (proposal.sourceUpdatedAt && date(proposal.sourceUpdatedAt) !== expected.updated_at) throw new Error("proposal_source_changed_retriage_required");
    desired = await mappedPayload(input.orgId, provider, proposal);
    if (!config.configured || !config.subdomain) throw new Error("provider_not_configured");
    await assertAccountBinding(input.orgId, provider, config.subdomain);
    if (!config.secureManagerAccess) throw new Error("insecure_manager_access");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    error = /^(missing_|provider_|proposal_|insecure_manager_access)/.test(message) ? message : "writeback_configuration_error";
  }
  const status: WritebackStatus = error ? "blocked" : config.autoApprove ? "pending" : "awaiting_approval";
  const rows = await sql`insert into provider_writebacks(org_id,ticket_id,assessment_id,provider,external_id,account_subdomain,status,proposal,desired,expected_source,local_snapshot,last_error,approved_at)
    values (${input.orgId},${input.ticketId},${input.assessmentId},${provider},${externalId},${config.subdomain},${status},${JSON.stringify(proposal)}::jsonb,${JSON.stringify(desired)}::jsonb,
      ${JSON.stringify(expected)}::jsonb,${JSON.stringify(localSnapshot(ticket))}::jsonb,${error},case when ${status === "pending"} then now() else null end)
    on conflict(org_id,assessment_id) do update set assessment_id=excluded.assessment_id returning id::text,status`;
  return { queued: true, id: String(rows[0].id), status: rows[0].status as WritebackStatus };
}

async function findQueueRow(orgId: string, queueId: string) {
  const rows = await getSql()`select * from provider_writebacks where org_id=${orgId} and id=${queueId}`;
  if (!rows[0]) throw new Error("writeback_not_found");
  return rows[0] as QueueRow;
}

export async function approveProviderWriteback(orgId: string, queueId: string) {
  await ensureProviderWritebackSchema();
  const row = await findQueueRow(orgId, queueId);
  if (!["awaiting_approval", "blocked", "failed"].includes(row.status)) throw new Error("writeback_not_approvable");
  const config = getProviderWritebackConfig(row.provider);
  if (!config.enabled) throw new Error("writeback_disabled");
  if (!config.configured || !config.subdomain) throw new Error("provider_not_configured");
  if (!config.secureManagerAccess) throw new Error("insecure_manager_access");
  if (row.account_subdomain && config.subdomain !== row.account_subdomain) throw new Error("provider_account_changed");
  await assertAccountBinding(orgId, row.provider, config.subdomain);
  const ticket = await ticketSnapshot(orgId, row.ticket_id);
  if (!ticket || !localUnchanged(ticket, row.local_snapshot)) throw new Error("local_ticket_changed_retriage_required");
  if (!await assessmentIsCurrent(orgId,row.ticket_id,row.assessment_id)) throw new Error("assessment_superseded_retriage_required");
  if (!date(row.expected_source.updated_at)) throw new Error("missing_source_version_reimport_required");
  if (row.proposal.sourceUpdatedAt && date(row.proposal.sourceUpdatedAt) !== date(row.expected_source.updated_at)) throw new Error("proposal_source_changed_retriage_required");
  const desired = await mappedPayload(orgId, row.provider, row.proposal);
  const rows = await getSql()`with changed as (update provider_writebacks set desired=${JSON.stringify(desired)}::jsonb,account_subdomain=${config.subdomain},
    status='pending',approved_at=now(),last_error=null,next_retry_at=null,updated_at=now()
    where org_id=${orgId} and id=${queueId} and status=${row.status} returning id,org_id,ticket_id,status),
    logged as (insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'user','ticket',ticket_id,'provider_writeback_approved',jsonb_build_object('writebackId',id,'provider',${row.provider}::text) from changed)
    select id::text,status from changed`;
  if (!rows[0]) throw new Error("writeback_changed_retry_action");
  return rows[0];
}

export async function retryProviderWriteback(orgId: string, queueId: string) {
  await ensureProviderWritebackSchema();
  // Never rebase a conflict onto a newer source version: a fresh triage/approval is required.
  const rows = await getSql()`with changed as (update provider_writebacks set status='awaiting_approval',next_retry_at=null,last_error=null,updated_at=now()
    where org_id=${orgId} and id=${queueId} and status in ('blocked','failed','retryable') returning id,org_id,ticket_id,status),
    logged as (insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'user','ticket',ticket_id,'provider_writeback_retry_requested',jsonb_build_object('writebackId',id) from changed)
    select id::text,status from changed`;
  if (!rows[0]) throw new Error("writeback_not_retryable_retriage_conflicts");
  return rows[0];
}

export async function listProviderWritebacks(orgId: string, limit = 50) {
  if (!hasDatabaseUrl()) return [];
  await ensureProviderWritebackSchema();
  return await getSql()`select w.id::text,w.ticket_id::text,w.assessment_id::text,w.provider,w.external_id,w.status,w.desired,w.proposal,
    w.attempts,w.last_error,w.created_at::text,w.completed_at::text,w.approved_at::text,t.title as ticket_title
    from provider_writebacks w join tickets t on t.id=w.ticket_id where w.org_id=${orgId} order by w.created_at desc limit ${Math.max(1, Math.min(100, Math.floor(limit) || 50))}`;
}

export async function getProviderWritebackStatus(orgId: string) {
  const configuration = providers.map(provider => getProviderWritebackConfig(provider));
  if (!hasDatabaseUrl()) return { configuration, counts: [] };
  await ensureProviderWritebackSchema();
  const counts = await getSql()`select provider,status,count(*)::int as count from provider_writebacks where org_id=${orgId} group by provider,status`;
  return { configuration, counts };
}

export function compareProviderWriteback(remote: Json, expected: Json, desired: Payload): "already_applied" | "safe_to_apply" | "conflict" {
  if (remote.priority === desired.priority && (desired.user_id === undefined || id(remote.user_id) === String(desired.user_id))) return "already_applied";
  const status = String(remote.status ?? "").trim().toLowerCase();
  if (status !== "not closed" && /resolved|closed|invoiced/.test(status)) return "conflict";
  if (!date(expected.updated_at) || date(remote.updated_at) !== date(expected.updated_at)) return "conflict";
  if ((remote.priority ?? null) !== expected.priority || id(remote.user_id) !== expected.user_id || (remote.status ?? null) !== expected.status) return "conflict";
  return "safe_to_apply";
}

class ProviderRequestError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); }
}

async function requestProvider(row: QueueRow, method: "GET" | "PUT", payload?: Payload) {
  const config = getProviderWritebackConfig(row.provider);
  if (!config.enabled || !config.configured || !config.baseUrl || config.subdomain !== row.account_subdomain || !config.secureManagerAccess) throw new ProviderRequestError("writeback_configuration_changed", false);
  const key = process.env[`${row.provider.toUpperCase()}_API_KEY`]?.trim().replace(/^Bearer\s+/i, "");
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/tickets/${row.external_id}`, {
      method, headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new ProviderRequestError("provider_network_error", true); }
  if (!response.ok) throw new ProviderRequestError(`provider_http_${response.status}`, response.status === 429 || response.status >= 500 || response.status === 408);
  let body: Json;
  try { body = object(await response.json()); } catch { throw new ProviderRequestError("provider_invalid_response", true); }
  const ticket = object(body.ticket);
  if (id(ticket.id) !== row.external_id) throw new ProviderRequestError("provider_identity_mismatch", false);
  return ticket;
}

async function finish(row: QueueRow, status: WritebackStatus, error: string | null = null) {
  const retryMinutes = Math.min(60, 2 ** Math.max(0, row.attempts));
  await getSql()`with changed as (update provider_writebacks set status=${status},last_error=${error},updated_at=now(),
    next_retry_at=case when ${status === "retryable"} then now()+(${retryMinutes}||' minutes')::interval else null end,
    completed_at=case when ${["succeeded","conflict","failed","superseded"].includes(status)} then now() else null end
    where id=${row.id} and org_id=${row.org_id} returning id,org_id,ticket_id)
    insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    select org_id,'system','ticket',ticket_id,'provider_writeback_result',
      jsonb_build_object('writebackId',id,'provider',${row.provider}::text,'status',${status}::text,'error',${error}::text) from changed`;
}

/** Recover the assessment->queue boundary after a process crash, without inventing proposals. */
export async function reconcileProviderWritebacks(orgId?: string, limit = 50) {
  if (!hasDatabaseUrl()) return { queued: 0 };
  await ensureProviderWritebackSchema();
  const rows = await getSql()`select a.id::text,a.org_id::text,a.ticket_id::text,a.result->'routing'->'proposedRouting' as proposal
    from jev_assessments a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id
    where a.kind='triage' and a.status='succeeded' and t.created_from in ('repairshopr','syncro')
      and t.status not in ('resolved','closed') and not t.triage_needs_human
      and (${orgId ?? null}::uuid is null or a.org_id=${orgId ?? null}::uuid)
      and a.result->'routing'->>'routingApplied'='true' and a.result->'routing'->>'needsHumanTriage'='false'
      and a.result->'assessment'->>'needsHumanTriage'='false'
      and a.result->'routing'->'proposedRouting'->>'priority' in ('P1','P2','P3','P4')
      and nullif(a.result->'routing'->'proposedRouting'->>'sourceUpdatedAt','') is not null
      and not exists(select 1 from jev_assessments newer where newer.org_id=a.org_id and newer.ticket_id=a.ticket_id and newer.kind='triage'
        and (newer.created_at,newer.id)>(a.created_at,a.id))
      and not exists(select 1 from provider_writebacks w where w.org_id=a.org_id and w.assessment_id=a.id)
    order by a.created_at desc limit ${Math.max(1,Math.min(200,Math.floor(limit) || 50))}`;
  let queued = 0;
  for (const row of rows) {
    const proposal = object(row.proposal);
    const result = await enqueueRoutingWriteback({ orgId:String(row.org_id),ticketId:String(row.ticket_id),assessmentId:String(row.id),
      proposal:{priority:proposal.priority as Priority,assignedUserId:typeof proposal.assignedUserId === "string" ? proposal.assignedUserId : null,
        sourceUpdatedAt:typeof proposal.sourceUpdatedAt === "string" ? proposal.sourceUpdatedAt : null} });
    if (result.queued) queued++;
  }
  return { queued };
}

/** GET -> compare -> PUT -> GET. Retried/ambiguous PUTs are always reconciled before another write. */
export async function processProviderWritebacks(options: { orgId?: string; limit?: number; budgetMs?: number } = {}) {
  if (!hasDatabaseUrl()) return { processed: 0, succeeded: 0, failed: 0, skipped: "database_not_configured" };
  await ensureProviderWritebackSchema();
  await reconcileProviderWritebacks(options.orgId);
  const sql = getSql(), deadline = Date.now() + Math.max(1_000,Math.min(180_000,options.budgetMs ?? 180_000));
  const limit = Math.max(1, Math.min(20, options.limit ?? 10));
  let processed = 0, succeeded = 0, failed = 0;
  const groups = options.orgId
    ? await sql`select distinct org_id::text,provider from provider_writebacks where org_id=${options.orgId} and status in ('pending','retryable','running')`
    : await sql`select distinct org_id::text,provider from provider_writebacks where status in ('pending','retryable','running')`;
  for (const group of groups) {
    const provider = group.provider as TicketProvider, config = getProviderWritebackConfig(provider);
    if (!config.enabled || !config.configured || !config.secureManagerAccess) continue;
    const token = randomUUID();
    const lock = await sql`insert into provider_writeback_locks(org_id,provider,token,expires_at) values (${group.org_id},${provider},${token},now()+interval '10 minutes')
      on conflict(org_id,provider) do update set token=excluded.token,expires_at=excluded.expires_at where provider_writeback_locks.expires_at<=now() returning token`;
    if (!lock[0]) continue;
    try {
      const queue = await sql`select * from provider_writebacks where org_id=${group.org_id} and provider=${provider}
        and (status='pending' or (status='retryable' and (next_retry_at is null or next_retry_at<=now())) or (status='running' and started_at<now()-interval '10 minutes'))
        order by created_at limit ${limit - processed}` as QueueRow[];
      for (const row of queue) {
        if (processed >= limit || Date.now() >= deadline) break;
        const ticket = await ticketSnapshot(row.org_id, row.ticket_id);
        if (!ticket || !localUnchanged(ticket, row.local_snapshot)) { await finish(row,"superseded","local_ticket_changed_retriage_required"); processed++; continue; }
        if (!await assessmentIsCurrent(row.org_id,row.ticket_id,row.assessment_id)) { await finish(row,"superseded","assessment_superseded_retriage_required"); processed++; continue; }
        if (row.account_subdomain !== config.subdomain) { await finish(row,"blocked","provider_account_changed"); processed++; continue; }
        try { await assertAccountBinding(row.org_id, provider, String(config.subdomain)); }
        catch { await finish(row,"blocked","provider_account_binding_mismatch"); processed++; continue; }
        const owned = await sql`update provider_writeback_locks set expires_at=now()+interval '10 minutes' where org_id=${row.org_id} and provider=${provider} and token=${token} returning token`;
        if (!owned[0]) break;
        await sql`update provider_writebacks set status='running',started_at=now(),attempts=attempts+1,updated_at=now() where id=${row.id}`;
        row.attempts++;
        processed++;
        try {
          const remote = await requestProvider(row,"GET");
          const comparison = compareProviderWriteback(remote,row.expected_source,row.desired);
          if (comparison === "conflict") { await finish(row,"conflict","source_changed_retriage_required"); failed++; continue; }
          if (comparison === "safe_to_apply") {
            await new Promise(resolve => setTimeout(resolve,350));
            // There is no documented conditional-write token in these APIs. This baseline check
            // minimizes, but cannot eliminate, a concurrent human update between GET and PUT.
            await requestProvider(row,"PUT",row.desired);
            await new Promise(resolve => setTimeout(resolve,350));
            const verified = await requestProvider(row,"GET");
            if (compareProviderWriteback(verified,row.expected_source,row.desired) !== "already_applied") {
              await finish(row,"conflict","provider_did_not_confirm_routing"); failed++; continue;
            }
          }
          await finish(row,"succeeded"); succeeded++;
        } catch (cause) {
          const retryable = cause instanceof ProviderRequestError && cause.retryable && row.attempts < 5;
          await finish(row,retryable ? "retryable" : "failed",cause instanceof ProviderRequestError ? cause.code : "writeback_processing_error"); failed++;
        }
        await new Promise(resolve => setTimeout(resolve,350));
      }
    } finally { await sql`delete from provider_writeback_locks where org_id=${group.org_id} and provider=${provider} and token=${token}`; }
    if (processed >= limit || Date.now() >= deadline) break;
  }
  return { processed, succeeded, failed };
}
