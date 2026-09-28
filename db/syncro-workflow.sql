-- Apply after schema.sql. No customer data or credentials in this migration.
alter table tickets add column if not exists syncro_evidence jsonb;

create table if not exists syncro_account_binding (
  org_id uuid primary key references orgs(id), subdomain text not null);

create table if not exists syncro_user_links (
      org_id uuid not null references orgs(id), external_id text not null,
      user_id uuid not null references users(id), primary key(org_id, external_id));

create table if not exists provider_user_links (
      org_id uuid not null references orgs(id), provider text not null, external_id text not null,
      user_id uuid not null references users(id), primary key(org_id, provider, external_id));

create table if not exists syncro_import_state (
      org_id uuid primary key references orgs(id), phase text not null default 'customers',
      page int not null default 1, cursor_at timestamptz, scan_started_at timestamptz not null default now());

alter table syncro_import_state add column if not exists customer_page int not null default 1;

create table if not exists syncro_import_queue (
      org_id uuid not null references orgs(id), external_id text not null, payload jsonb not null,
      pending boolean not null default true, queued_at timestamptz not null default now(),
      attempts int not null default 0, last_error text, retry_at timestamptz,
      primary key(org_id, external_id));
