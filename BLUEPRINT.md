# Alert Triage + Ticket Orchestration (MVP Blueprint)

This repository now contains a practical, email-first product blueprint for building an incident triage and ticketing platform on **Vercel + Neon**.

## 1) MVP scope (email-first)

### Goals
- Ingest inbound alert/ticket emails.
- Normalize them into a shared event schema.
- Deduplicate similar alerts.
- Prioritize by **Importance × Urgency**.
- Auto-create or update tickets.
- Assign ownership and notify assignees.

### Out of scope (initial)
- Deep third-party integrations (PagerDuty/Jira/ServiceNow).
- Full AI autonomy with no human override.
- Multi-tenant enterprise controls (can be added after single-org validation).

## 2) Suggested architecture

- **Frontend:** Next.js app on Vercel.
- **Backend:** Next.js route handlers + background jobs.
- **Database:** Neon (Postgres).
- **Inbound email:** provider webhook endpoint (`/api/webhooks/inbound-email`).
- **Outbound notifications:** email service provider API.
- **Observability:** structured logs + audit trail tables.

## 3) Neon schema (starter)

```sql
-- USERS & ORG
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
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

create table teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(org_id, name)
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_on_call boolean not null default false,
  primary key (team_id, user_id)
);

-- INGESTED ALERTS
create table alert_events (
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

create index alert_events_org_received_idx on alert_events(org_id, received_at desc);
create index alert_events_fingerprint_idx on alert_events(org_id, fingerprint);

-- INCIDENT/CORRELATION
create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  status text not null check (status in ('open','monitoring','resolved','closed')),
  dedup_key text,
  importance_score int not null default 0,
  urgency_score int not null default 0,
  priority text not null check (priority in ('P1','P2','P3','P4')),
  confidence numeric(5,2),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index incidents_org_priority_idx on incidents(org_id, priority, updated_at desc);
create index incidents_org_dedup_idx on incidents(org_id, dedup_key);

create table incident_alert_links (
  incident_id uuid not null references incidents(id) on delete cascade,
  alert_event_id uuid not null references alert_events(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (incident_id, alert_event_id)
);

-- TICKETING
create table tickets (
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

create index tickets_org_status_idx on tickets(org_id, status, updated_at desc);
create index tickets_org_priority_idx on tickets(org_id, priority, updated_at desc);

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  author_email text,
  body text not null,
  created_via text not null check (created_via in ('ui','email','sms','system')),
  created_at timestamptz not null default now()
);

-- AUTOMATION RULES
create table routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  match_json jsonb not null,
  action_json jsonb not null,
  priority int not null default 100,
  created_at timestamptz not null default now()
);

-- AUDIT TRAIL
create table audit_logs (
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
```

## 4) Priority scoring matrix (transparent, explainable)

Use a weighted additive score, then map to a P-level.

### Importance (0–50)
- Customer-facing outage: +20
- Revenue-critical workflow impacted: +15
- Security/compliance signal: +15
- Internal-only degradation: +5

### Urgency (0–50)
- Active SLA breach risk (under 15 min): +20
- Frequency spike (>= 5 similar events / 10 min): +15
- Repeated incident within 24h: +10
- Business hours critical path: +5

### Final score and priority
- **80–100 → P1**
- **60–79 → P2**
- **35–59 → P3**
- **0–34 → P4**

> Keep manual override enabled so agents/managers can adjust priority with an audit reason.

## 5) Dedup/correlation strategy (MVP)

1. Build a deterministic `fingerprint` from normalized fields:
   - source, service/host token, error signature, normalized subject stem.
2. Search for open incidents with same `dedup_key` in last 60 minutes.
3. If exact key matches, append alert to same incident.
4. If fuzzy similarity > configured threshold, suggest merge in UI.
5. Each duplicate increments incident `blast_count` (can influence urgency).

## 6) Assignment model (MVP)

1. Match routing rules by source/keywords/severity.
2. Route to team.
3. Auto-assign by round-robin among on-call active members.
4. Start ack timer by priority (P1: 5m, P2: 15m, P3: 60m, P4: 4h).
5. Escalate to manager if unacknowledged.

## 7) Wireframe-level screen map

### A) Triage Inbox
- Left: filters (priority, team, status, source).
- Center: queue list (severity color + title + age + duplicate count).
- Right: incident/ticket detail panel.

### B) Ticket Detail
- Header: status, priority, assignee, SLA timer.
- Tabs: Timeline, Related Alerts, Comments, Audit.
- Quick actions: Acknowledge, Assign, Merge, Escalate, Resolve.

### C) Rules & Routing
- Rule list with drag-priority ordering.
- Condition builder (contains/regex/source/team).
- Simulation panel (“this sample alert routes to Team X as P2”).

### D) SLA & Operations Dashboard
- Open tickets by priority.
- Mean time to acknowledge/resolve.
- Duplicate suppression rate.
- Team workload and escalation count.

## 8) API endpoint draft

- `POST /api/webhooks/inbound-email`
- `POST /api/alerts/ingest` (internal normalize endpoint)
- `GET /api/tickets`
- `POST /api/tickets/:id/assign`
- `POST /api/tickets/:id/priority`
- `POST /api/incidents/:id/merge`
- `POST /api/notifications/send`

## 9) Next implementation steps

1. Scaffold Next.js app routes and Neon connection layer.
2. Implement inbound email webhook verification and parsing.
3. Implement `fingerprint` generation and dedup lookup.
4. Create ticket lifecycle endpoints and queue UI.
5. Add routing rules evaluator and assignment worker.
6. Add audit logging for all state changes.

