create extension if not exists pgcrypto;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('reporter','agent','manager','admin')),
  timezone text default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(org_id, email)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(org_id, name)
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_on_call boolean not null default false,
  primary key (team_id, user_id)
);

create table if not exists alert_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  source text not null default 'email',
  external_id text,
  sender_email text,
  subject text,
  body_text text,
  raw_payload jsonb not null,
  fingerprint text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  status text not null check (status in ('open','monitoring','resolved','closed')),
  dedup_key text,
  importance_score int not null default 0,
  urgency_score int not null default 0,
  priority text not null check (priority in ('P1','P2','P3','P4')),
  confidence numeric(5,2),
  blast_count int not null default 1,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists incident_alert_links (
  incident_id uuid not null references incidents(id) on delete cascade,
  alert_event_id uuid not null references alert_events(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (incident_id, alert_event_id)
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  incident_id uuid references incidents(id) on delete set null,
  ticket_number bigserial,
  title text not null,
  description text,
  status text not null check (status in ('new','triaged','assigned','in_progress','waiting','resolved','closed')),
  priority text not null check (priority in ('P1','P2','P3','P4')),
  importance_score int not null default 0,
  urgency_score int not null default 0,
  assigned_team_id uuid references teams(id) on delete set null,
  assigned_user_id uuid references users(id) on delete set null,
  sla_due_at timestamptz,
  reporter_email text,
  created_from text not null default 'alert_email',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  author_email text,
  body text not null,
  created_via text not null check (created_via in ('ui','email','sms','system')),
  created_at timestamptz not null default now()
);

create table if not exists routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  match_json jsonb not null,
  action_json jsonb not null,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  unique(org_id, name)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_type text not null check (actor_type in ('user','system')),
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists alert_events_org_received_idx on alert_events(org_id, received_at desc);
create index if not exists alert_events_fingerprint_idx on alert_events(org_id, fingerprint);
create index if not exists incidents_org_priority_idx on incidents(org_id, priority, updated_at desc);
create index if not exists incidents_org_dedup_idx on incidents(org_id, dedup_key);
create index if not exists tickets_org_status_idx on tickets(org_id, status, updated_at desc);
create index if not exists tickets_org_priority_idx on tickets(org_id, priority, updated_at desc);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incidents_touch_updated_at on incidents;
create trigger incidents_touch_updated_at
before update on incidents
for each row execute function touch_updated_at();

drop trigger if exists tickets_touch_updated_at on tickets;
create trigger tickets_touch_updated_at
before update on tickets
for each row execute function touch_updated_at();

with org as (
  insert into orgs (name)
  values ('Default Operations')
  on conflict (name) do update set name = excluded.name
  returning id
),
seed_users as (
  insert into users (org_id, email, full_name, role)
  select org.id, seed.email, seed.full_name, seed.role
  from org
  cross join (
    values
      ('maya@example.com', 'Maya Chen', 'manager'),
      ('owen@example.com', 'Owen Patel', 'agent'),
      ('riley@example.com', 'Riley Gomez', 'agent'),
      ('sam@example.com', 'Sam Rivera', 'agent')
  ) as seed(email, full_name, role)
  on conflict (org_id, email) do update
    set full_name = excluded.full_name,
        role = excluded.role
  returning id, email
),
seed_teams as (
  insert into teams (org_id, name)
  select org.id, seed.name
  from org
  cross join (
    values ('Platform'), ('Messaging'), ('Database'), ('Security')
  ) as seed(name)
  on conflict (org_id, name) do update set name = excluded.name
  returning id, name
)
insert into team_members (team_id, user_id, is_on_call)
select seed_teams.id, seed_users.id, true
from seed_teams
join seed_users on
  (seed_teams.name = 'Platform' and seed_users.email = 'maya@example.com') or
  (seed_teams.name = 'Messaging' and seed_users.email = 'owen@example.com') or
  (seed_teams.name = 'Database' and seed_users.email = 'riley@example.com') or
  (seed_teams.name = 'Security' and seed_users.email = 'sam@example.com')
on conflict (team_id, user_id) do update set is_on_call = excluded.is_on_call;

with org as (
  select id from orgs where name = 'Default Operations'
),
platform as (
  select teams.id as team_id, users.id as user_id
  from teams
  join org on org.id = teams.org_id
  join users on users.org_id = org.id and users.email = 'maya@example.com'
  where teams.name = 'Platform'
),
incident as (
  insert into incidents (
    org_id,
    title,
    status,
    dedup_key,
    importance_score,
    urgency_score,
    priority,
    confidence,
    blast_count,
    first_seen_at,
    last_seen_at
  )
  select
    org.id,
    'Checkout API returning 502 for paid accounts',
    'open',
    'seed-checkout-502',
    45,
    42,
    'P1',
    0.92,
    7,
    now() - interval '52 minutes',
    now() - interval '3 minutes'
  from org
  where not exists (
    select 1 from incidents where dedup_key = 'seed-checkout-502'
  )
  returning id, org_id
),
event as (
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
  select
    org.id,
    'email',
    'seed-msg-1',
    'alerts@stripe-monitor.example',
    'Checkout API returning 502 for paid accounts',
    '5xx spike detected across paid checkout requests.',
    '{"seed": true}'::jsonb,
    'seed-checkout-502'
  from org
  where not exists (
    select 1 from alert_events where external_id = 'seed-msg-1'
  )
  returning id
),
ticket as (
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
    reporter_email
  )
  select
    incident.org_id,
    incident.id,
    'Checkout API returning 502 for paid accounts',
    'Customer-facing checkout failures are breaching SLA.',
    'in_progress',
    'P1',
    45,
    42,
    platform.team_id,
    platform.user_id,
    now() - interval '8 minutes',
    'alerts@stripe-monitor.example'
  from incident, platform
  where not exists (
    select 1 from tickets where incident_id = incident.id
  )
  returning id, incident_id
)
insert into incident_alert_links (incident_id, alert_event_id)
select ticket.incident_id, event.id
from ticket, event
on conflict do nothing;
