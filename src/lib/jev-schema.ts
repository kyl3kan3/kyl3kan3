import { getSql, hasDatabaseUrl } from "./db";

type SchemaReadyRow = { ready: boolean };

let jevSchemaPromise: Promise<void> | null = null;

async function applyJevSchema() {
  const sql = getSql();

  await sql`alter table tickets add column if not exists issue_type text`;
  await sql`alter table tickets add column if not exists triage_confidence numeric`;
  await sql`
    alter table tickets
    add column if not exists triage_needs_human boolean not null default false
  `;
  await sql`alter table tickets add column if not exists first_response_at timestamptz`;
  await sql`alter table tickets add column if not exists resolved_at timestamptz`;
  await sql`
    alter table tickets
    add column if not exists completion_cycle int not null default 0
  `;
  await sql`
    alter table tickets
    add column if not exists reopened_count int not null default 0
  `;

  await sql`
    create table if not exists ticket_status_events (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references orgs(id) on delete cascade,
      ticket_id uuid not null references tickets(id) on delete cascade,
      from_status text check (
        from_status is null or
        from_status in ('new','triaged','assigned','in_progress','waiting','resolved','closed')
      ),
      to_status text not null check (
        to_status in ('new','triaged','assigned','in_progress','waiting','resolved','closed')
      ),
      completion_cycle int not null default 0 check (completion_cycle >= 0),
      actor_user_id uuid references users(id) on delete set null,
      source text not null default 'system',
      metadata jsonb not null default '{}'::jsonb,
      changed_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists ticket_completion_submissions (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references orgs(id) on delete cascade,
      ticket_id uuid not null references tickets(id) on delete cascade,
      completion_cycle int not null check (completion_cycle >= 1),
      technician_user_id uuid references users(id) on delete set null,
      technician_name text,
      technician_role text,
      technician_snapshot jsonb not null default '{}'::jsonb,
      issue_type text,
      resolution_summary text,
      customer_next_steps text,
      verification_evidence text,
      submitted_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(ticket_id, completion_cycle)
    )
  `;

  await sql`
    create table if not exists jev_assessments (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references orgs(id) on delete cascade,
      ticket_id uuid not null references tickets(id) on delete cascade,
      completion_submission_id uuid references ticket_completion_submissions(id) on delete set null,
      kind text not null check (kind in ('triage','completion_review')),
      completion_cycle int not null default 0 check (completion_cycle >= 0),
      evaluated_user_id uuid references users(id) on delete set null,
      evaluated_role text,
      issue_type text,
      status text not null default 'pending' check (
        status in (
          'pending',
          'running',
          'succeeded',
          'retryable',
          'failed',
          'not_configured',
          'superseded'
        )
      ),
      idempotency_key text not null unique,
      input_snapshot jsonb not null default '{}'::jsonb,
      model text,
      rubric_version text,
      procedure_version text,
      rubric jsonb,
      result jsonb,
      overall_score numeric,
      evidence_coverage numeric,
      missing_evidence_count int not null default 0 check (missing_evidence_count >= 0),
      attempt_count int not null default 0 check (attempt_count >= 0),
      next_retry_at timestamptz,
      last_error text,
      provider_request_id text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    alter table jev_assessments
    add column if not exists procedure_version text
  `;

  await sql`
    create index if not exists ticket_status_events_ticket_changed_idx
    on ticket_status_events(ticket_id, changed_at desc)
  `;
  await sql`
    create index if not exists ticket_status_events_org_changed_idx
    on ticket_status_events(org_id, changed_at desc)
  `;
  await sql`
    create index if not exists ticket_completion_submissions_ticket_cycle_idx
    on ticket_completion_submissions(ticket_id, completion_cycle desc)
  `;
  await sql`
    create index if not exists ticket_completion_submissions_cohort_idx
    on ticket_completion_submissions(org_id, technician_role, issue_type, submitted_at desc)
  `;
  await sql`
    create index if not exists jev_assessments_ticket_kind_cycle_idx
    on jev_assessments(ticket_id, kind, completion_cycle desc, created_at desc)
  `;
  await sql`
    create index if not exists jev_assessments_org_status_retry_idx
    on jev_assessments(org_id, status, next_retry_at)
    where status in ('pending','retryable')
  `;
  await sql`
    create index if not exists jev_assessments_cohort_idx
    on jev_assessments(org_id, kind, evaluated_role, issue_type, created_at desc)
  `;
  await sql`
    create index if not exists jev_assessments_submission_idx
    on jev_assessments(completion_submission_id)
    where completion_submission_id is not null
  `;

  await sql`
    drop trigger if exists ticket_completion_submissions_touch_updated_at
    on ticket_completion_submissions
  `;
  await sql`
    create trigger ticket_completion_submissions_touch_updated_at
    before update on ticket_completion_submissions
    for each row execute function touch_updated_at()
  `;
  await sql`
    drop trigger if exists jev_assessments_touch_updated_at
    on jev_assessments
  `;
  await sql`
    create trigger jev_assessments_touch_updated_at
    before update on jev_assessments
    for each row execute function touch_updated_at()
  `;
}

async function isJevSchemaReady() {
  const sql = getSql();
  const rows = (await sql`
    select (
      (
        select count(*) = 7
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'tickets'
          and column_name in (
            'issue_type',
            'triage_confidence',
            'triage_needs_human',
            'first_response_at',
            'resolved_at',
            'completion_cycle',
            'reopened_count'
          )
      )
      and to_regclass('ticket_status_events') is not null
      and to_regclass('ticket_completion_submissions') is not null
      and to_regclass('jev_assessments') is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'jev_assessments'
          and column_name = 'procedure_version'
      )
      and to_regclass('ticket_status_events_ticket_changed_idx') is not null
      and to_regclass('ticket_completion_submissions_ticket_cycle_idx') is not null
      and to_regclass('jev_assessments_ticket_kind_cycle_idx') is not null
      and exists (
        select 1
        from pg_trigger
        where tgrelid = to_regclass('ticket_completion_submissions')
          and tgname = 'ticket_completion_submissions_touch_updated_at'
          and not tgisinternal
      )
      and exists (
        select 1
        from pg_trigger
        where tgrelid = to_regclass('jev_assessments')
          and tgname = 'jev_assessments_touch_updated_at'
          and not tgisinternal
      )
    ) as ready
  `) as SchemaReadyRow[];

  return Boolean(rows[0]?.ready);
}

async function initializeJevSchema() {
  if (await isJevSchemaReady()) return;
  await applyJevSchema();
}

export async function ensureJevSchema() {
  if (!hasDatabaseUrl()) return;

  jevSchemaPromise ??= initializeJevSchema();
  try {
    await jevSchemaPromise;
  } catch (error) {
    jevSchemaPromise = null;
    throw error;
  }
}
