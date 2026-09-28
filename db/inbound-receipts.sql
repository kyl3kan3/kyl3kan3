-- Non-destructive delivery idempotency. Historical alert_events are not rewritten.
-- Existing successful deliveries are recognized lazily by source/external_id.
create table if not exists inbound_webhook_receipts (
  org_id uuid not null references orgs(id) on delete cascade,
  source text not null,
  external_id text not null,
  claim_token uuid not null,
  lease_until timestamptz not null,
  response jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, source, external_id)
);
