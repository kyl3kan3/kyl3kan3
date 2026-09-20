import { getSql } from "./db";
import type { JevWorkHistoryEntry } from "./jev";

export type RepairShoprFetch = (path: string, params: Record<string, string>) => Promise<unknown>;
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function externalId(value: unknown) {
  const id = String(value ?? "");
  return /^\d+$/.test(id) ? id : null;
}
export function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function commentEvidence(value: unknown): JevWorkHistoryEntry | null {
  const row = record(value);
  const at = timestamp(row.created_at);
  if (!externalId(row.id) || !at || typeof row.body !== "string" || !row.body.trim()) return null;
  const staff = Boolean(externalId(row.user_id));
  return {
    at,
    actor: staff ? `RepairShopr technician ${row.user_id}` : "customer or unattributed participant",
    action: staff && row.hidden === false ? "customer-facing technician message" : staff ? "internal technician note" : "external or unattributed note",
    evidence: `${typeof row.subject === "string" ? row.subject + "\n" : ""}${row.body}`,
  };
}

let ready: Promise<void> | undefined;
export async function ensureRepairShoprWorkflowSchema() {
  const sql = getSql();
  ready ??= (async () => {
    await sql`alter table tickets add column if not exists repairshopr_evidence jsonb`;
    await sql`create table if not exists repairshopr_account_binding (
      org_id uuid primary key references orgs(id), subdomain text not null)`;
    await sql`create table if not exists repairshopr_user_links (
      org_id uuid not null references orgs(id), external_id text not null,
      user_id uuid not null references users(id), primary key(org_id, external_id))`;
    await sql`create table if not exists repairshopr_import_state (
      org_id uuid primary key references orgs(id), phase text not null default 'customers',
      page int not null default 1, cursor_at timestamptz, scan_started_at timestamptz not null default now())`;
    await sql`alter table repairshopr_import_state add column if not exists customer_page int not null default 1`;
    await sql`create table if not exists repairshopr_import_queue (
      org_id uuid not null references orgs(id), external_id text not null, payload jsonb not null,
      pending boolean not null default true, queued_at timestamptz not null default now(),
      attempts int not null default 0, last_error text, retry_at timestamptz,
      primary key(org_id, external_id))`;
  })();
  try { await ready; } catch (error) { ready = undefined; throw error; }
}

export async function bindRepairShoprAccount(orgId: string, subdomain: string) {
  const sql=getSql();
  await sql`insert into repairshopr_account_binding(org_id,subdomain) values (${orgId},${subdomain}) on conflict do nothing`;
  const binding=await sql`select subdomain from repairshopr_account_binding where org_id=${orgId}`;
  if(binding[0]?.subdomain !== subdomain) throw new Error("RepairShopr account changed: use a separate organization/database instead of mixing account IDs");
}

export async function mapRepairShoprUser(orgId: string, value: unknown, fetcher: RepairShoprFetch): Promise<string | null> {
  const id = externalId(value);
  if (!id) return null;
  const sql = getSql();
  const existing = await sql`select user_id::text from repairshopr_user_links where org_id=${orgId} and external_id=${id}`;
  if (existing[0]) return String(existing[0].user_id);
  const user = record(record(await fetcher(`/users/${id}`, {})).user);
  if (externalId(user.id) !== id) throw new Error("RepairShopr user response does not match requested identity");
  // Never import upstream administrator privileges or merge users by display name.
  const name = typeof user.full_name === "string" ? user.full_name : `RepairShopr technician ${id}`;
  const rows = await sql`insert into users (org_id,email,full_name,role)
    values (${orgId},${`repairshopr-${id}@identity.invalid`},${name},'agent')
    on conflict (org_id,email) do update set full_name=excluded.full_name returning id::text`;
  const localId = String(rows[0].id);
  await sql`insert into repairshopr_user_links(org_id,external_id,user_id) values (${orgId},${id},${localId})
    on conflict (org_id,external_id) do nothing`;
  return localId;
}

export async function fetchRepairShoprHistory(ticketId: string, fetcher: RepairShoprFetch) {
  if (!externalId(ticketId)) throw new Error("Invalid RepairShopr ticket ID");
  const history: JevWorkHistoryEntry[] = [];
  const seen = new Set<string>();
  // Explicit bound: fail without claiming a complete import if unusually large.
  for (let page = 1; page <= 100; page++) {
    const payload = record(await fetcher(`/tickets/${ticketId}/comments`, {
      page: String(page), per_page: "100", comment_format: "plaintext", sort_by: "created_at", sort_direction: "ASC",
    }));
    if (!Array.isArray(payload.comments)) throw new Error("RepairShopr comments response is missing comments");
    for (const comment of payload.comments) {
      const id = externalId(record(comment).id);
      const evidence = commentEvidence(comment);
      if (id && evidence && !seen.has(id)) { seen.add(id); history.push(evidence); }
    }
    const total = Number(record(payload.meta).total_pages);
    if ((Number.isFinite(total) && page >= total) || (!Number.isFinite(total) && payload.comments.length === 0)) {
      return history.sort((a,b) => a.at.localeCompare(b.at));
    }
  }
  throw new Error("RepairShopr comment history exceeds 100 pages; manual review required");
}

export async function runRepairShoprImportBatch(input: {
  orgId: string; fetcher: RepairShoprFetch; renew: () => Promise<void>;
  customer: (raw: unknown) => Promise<void>; ticket: (raw: unknown) => Promise<void>;
}) {
  const { orgId, fetcher, renew } = input;
  const sql = getSql();
  await ensureRepairShoprWorkflowSchema();
  await sql`insert into repairshopr_import_state(org_id) values (${orgId}) on conflict do nothing`;
  let customersSynced = 0, ticketsSynced = 0;
  const deadline = Date.now() + 200_000;
  // Queue first, so the discovery cursor never skips a ticket after a crash.
  const state = (await sql`select phase,page,customer_page,cursor_at::text,scan_started_at::text from repairshopr_import_state where org_id=${orgId}`)[0];
  const currentPage = state.phase === "customers" ? Number(state.customer_page) : Number(state.page);
  const params: Record<string,string> = { page: String(currentPage) };
  if (state.phase === "tickets" && state.cursor_at) params.since_updated_at = new Date(new Date(String(state.cursor_at)).getTime() - 60_000).toISOString();
  const payload = record(await fetcher(`/${state.phase}`, params));
  const records = payload[String(state.phase)];
  if (!Array.isArray(records)) throw new Error(`RepairShopr ${state.phase} response is malformed`);
  for (const raw of records) {
    if (state.phase === "customers") { await input.customer(raw); customersSynced++; }
    else {
      const id = externalId(record(raw).id);
      if (!id) throw new Error("RepairShopr returned a ticket without a valid ID");
      await sql`insert into repairshopr_import_queue(org_id,external_id,payload) values (${orgId},${id},${JSON.stringify(raw)}::jsonb)
        on conflict(org_id,external_id) do update set payload=excluded.payload,pending=true,queued_at=now(),attempts=0,retry_at=null
        where repairshopr_import_queue.payload is distinct from excluded.payload`;
    }
  }
  const total = Number(record(payload.meta).total_pages);
  const last = Number.isFinite(total) ? currentPage >= total : records.length === 0;
  if (!last && records.length === 0) throw new Error("RepairShopr pagination ended unexpectedly");
  if (state.phase === "customers") {
    // Customer backfill must never hold up ticket monitoring for a large account.
    await sql`update repairshopr_import_state set phase='tickets',page=1,customer_page=${last ? 1 : currentPage+1} where org_id=${orgId}`;
  } else if (last && state.phase === "tickets") {
    await sql`update repairshopr_import_state set phase='customers',page=1,cursor_at=scan_started_at,scan_started_at=now() where org_id=${orgId}`;
  } else {
    await sql`update repairshopr_import_state set phase=${last ? "tickets" : String(state.phase)},page=${last ? 1 : Number(state.page)+1} where org_id=${orgId}`;
  }
  const queue = await sql`select external_id from repairshopr_import_queue where org_id=${orgId} and pending
    and (retry_at is null or retry_at<=now()) order by attempts,queued_at limit 25`;
  let failed = 0;
  for (const item of queue) {
    if (Date.now() >= deadline) break;
    await renew();
    try {
      const detail = record(await fetcher(`/tickets/${item.external_id}`, {})).ticket;
      if (externalId(record(detail).id) !== item.external_id) throw new Error("RepairShopr ticket identity mismatch");
      await input.ticket(detail);
      await sql`update repairshopr_import_queue set pending=false,last_error=null,retry_at=null where org_id=${orgId} and external_id=${item.external_id}`;
      ticketsSynced++;
    } catch {
      failed++;
      await sql`update repairshopr_import_queue set attempts=attempts+1,last_error='Ticket detail/history import failed; verify API permissions and retry',retry_at=now()+interval '5 minutes'
        where org_id=${orgId} and external_id=${item.external_id}`;
    }
  }
  const pending = await sql`select count(*)::int as count from repairshopr_import_queue where org_id=${orgId} and pending`;
  return { customersSynced, ticketsSynced, pendingTickets: Number(pending[0].count), failedTickets: failed,
    cursorUpdatedAt: last && state.phase === "tickets" ? String(state.scan_started_at) : state.cursor_at ? String(state.cursor_at) : null };
}
