-- Runtime equivalent: ensureProviderWritebackSchema(). No external writes are enabled by this migration.
create table if not exists provider_user_links (
  org_id uuid not null references orgs(id), provider text not null, external_id text not null,
  user_id uuid not null references users(id), primary key(org_id,provider,external_id)
);
create table if not exists provider_writebacks (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  ticket_id uuid not null references tickets(id) on delete cascade,
  assessment_id uuid not null references jev_assessments(id) on delete cascade,
  provider text not null check(provider in ('repairshopr','syncro')), external_id text not null,
  account_subdomain text,
  status text not null check(status in ('awaiting_approval','pending','running','retryable','succeeded','conflict','blocked','failed','superseded')),
  proposal jsonb not null, desired jsonb not null, expected_source jsonb not null, local_snapshot jsonb not null,
  attempts int not null default 0, next_retry_at timestamptz, last_error text,
  approved_at timestamptz, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(org_id,assessment_id)
);
create index if not exists provider_writebacks_queue_idx on provider_writebacks(provider,status,next_retry_at,created_at);
create table if not exists provider_writeback_locks (
  org_id uuid not null references orgs(id), provider text not null, token uuid not null,
  expires_at timestamptz not null, primary key(org_id,provider)
);
