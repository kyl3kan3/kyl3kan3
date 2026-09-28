-- In-app operational reminders; no outbound messages or employee scoring.
create table if not exists workflow_notifications (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  kind text not null check(kind in ('sla_breach','source_deadline','unassigned','human_triage')),
  status text not null default 'open' check(status in ('open','acknowledged','resolved')),
  severity text not null check(severity in ('info','warning','critical')), title text not null, message text not null,
  metadata jsonb not null default '{}'::jsonb, occurrences int not null default 1,
  opened_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz, resolved_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(org_id,ticket_id,kind)
);
create index if not exists workflow_notifications_inbox_idx on workflow_notifications(org_id,status,opened_at desc);
