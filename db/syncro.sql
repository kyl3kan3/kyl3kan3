-- Idempotent Syncro mirror migration. Apply after schema.sql.
alter table tickets add column if not exists syncro_ticket_id text;

alter table tickets add column if not exists syncro_ticket_number text;

alter table tickets add column if not exists syncro_customer_id text;

alter table tickets add column if not exists syncro_status text;

alter table tickets add column if not exists syncro_url text;

alter table tickets add column if not exists syncro_updated_at timestamptz;

alter table tickets add column if not exists syncro_payload jsonb;

create table if not exists syncro_customers (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references orgs(id) on delete cascade,
      syncro_customer_id text not null,
      name text,
      email text,
      phone text,
      remote_updated_at timestamptz,
      raw_payload jsonb not null,
      last_synced_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(org_id, syncro_customer_id)
    );

create table if not exists syncro_sync_runs (
      id uuid primary key default gen_random_uuid(),
      org_id uuid references orgs(id) on delete cascade,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      status text not null check (status in ('running','success','error')),
      customers_synced int not null default 0,
      tickets_synced int not null default 0,
      error text,
      cursor_updated_at timestamptz
    );

create table if not exists syncro_sync_locks (
      org_id uuid primary key references orgs(id) on delete cascade,
      lock_token uuid not null,
      acquired_at timestamptz not null default now(),
      expires_at timestamptz not null
    );

create unique index if not exists tickets_org_syncro_ticket_idx
    on tickets(org_id, syncro_ticket_id)
    where syncro_ticket_id is not null;

create index if not exists tickets_org_syncro_customer_idx
    on tickets(org_id, syncro_customer_id)
    where syncro_customer_id is not null;

create index if not exists syncro_sync_runs_started_idx
    on syncro_sync_runs(started_at desc);

drop trigger if exists syncro_customers_touch_updated_at
    on syncro_customers;

create trigger syncro_customers_touch_updated_at
    before update on syncro_customers
    for each row execute function touch_updated_at();
