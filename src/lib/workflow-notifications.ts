import { getSql, hasDatabaseUrl } from "./db";

export type WorkflowNotificationKind = "sla_breach" | "source_deadline" | "unassigned" | "human_triage";
export type WorkflowNotificationStatus = "open" | "acknowledged" | "resolved";

let ready: Promise<void> | undefined;
export async function ensureWorkflowNotificationSchema() {
  ready ??= (async () => {
    const sql = getSql();
    await sql`create table if not exists workflow_notifications (
      id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id) on delete cascade,
      ticket_id uuid not null references tickets(id) on delete cascade,
      kind text not null check(kind in ('sla_breach','source_deadline','unassigned','human_triage')),
      status text not null default 'open' check(status in ('open','acknowledged','resolved')),
      severity text not null check(severity in ('info','warning','critical')), title text not null, message text not null,
      metadata jsonb not null default '{}'::jsonb, occurrences int not null default 1,
      opened_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
      acknowledged_at timestamptz, resolved_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique(org_id,ticket_id,kind))`;
    await sql`create index if not exists workflow_notifications_inbox_idx on workflow_notifications(org_id,status,opened_at desc)`;
  })();
  try { await ready; } catch (error) { ready = undefined; throw error; }
}

/** Operational reminders only: never employee ratings, performance penalties, or outbound emails. */
export async function processWorkflowNotifications(options: { orgId?: string } = {}) {
  if (!hasDatabaseUrl()) return { activeConditions: 0, resolved: 0, skipped: "database_not_configured" };
  await ensureWorkflowNotificationSchema();
  const rawGrace = Number(process.env.WORKFLOW_UNASSIGNED_GRACE_MINUTES ?? "15");
  const grace = Number.isFinite(rawGrace) ? Math.max(0,Math.min(1440,rawGrace)) : 15;
  const rows = await getSql()`with active_tickets as (
      select t.*,coalesce((to_jsonb(t)->>'response_due_at')::timestamptz,
        case when t.created_from not in ('repairshopr','syncro') then t.sla_due_at end) as response_deadline
      from tickets t where t.status not in ('resolved','closed')
        and (${options.orgId ?? null}::uuid is null or t.org_id=${options.orgId ?? null}::uuid)
    ), conditions as (
      select org_id,id as ticket_id,'sla_breach'::text as kind,
        case when priority='P1' then 'critical' else 'warning' end as severity,
        'Response deadline passed'::text as title,
        'No customer-facing staff response is recorded before the workspace response deadline. Check the ticket history; missing evidence is not a performance rating.'::text as message,
        jsonb_build_object('priority',priority,'deadline',response_deadline,'deadlineType','response') as metadata
      from active_tickets where response_deadline<now() and first_response_at is null
      union all
      select org_id,id,'source_deadline',case when priority='P1' then 'critical' else 'warning' end,
        'Source ticket deadline passed',
        'The ticket is still open past its source-system completion deadline. This is separate from the workspace response SLA.',
        jsonb_build_object('priority',priority,'deadline',sla_due_at,'deadlineType','source_completion','provider',created_from)
      from active_tickets where created_from in ('repairshopr','syncro') and sla_due_at<now()
      union all
      select org_id,id,'unassigned',case when priority='P1' then 'critical' else 'warning' end,
        'Ticket needs an owner','No technician is assigned. Review the queue and choose an appropriate available owner.',
        jsonb_build_object('priority',priority,'assignedTeamId',assigned_team_id,'graceMinutes',${grace}::numeric)
      from active_tickets where assigned_user_id is null and created_at<=now()-(${grace}::text||' minutes')::interval
      union all
      select org_id,id,'human_triage','warning','Human triage required',
        'Review the ticket classification and routing. Jev has not cleared this ticket for automatic routing.',
        jsonb_build_object('priority',priority,'issueType',issue_type,'confidence',triage_confidence)
      from active_tickets where triage_needs_human
    ), upserted as (
      insert into workflow_notifications(org_id,ticket_id,kind,severity,title,message,metadata)
      select org_id,ticket_id,kind,severity,title,message,metadata from conditions
      on conflict(org_id,ticket_id,kind) do update set
        severity=excluded.severity,title=excluded.title,message=excluded.message,metadata=excluded.metadata,
        last_seen_at=now(),updated_at=now(),
        status=case when workflow_notifications.status='resolved' then 'open' else workflow_notifications.status end,
        occurrences=workflow_notifications.occurrences+case when workflow_notifications.status='resolved' then 1 else 0 end,
        opened_at=case when workflow_notifications.status='resolved' then now() else workflow_notifications.opened_at end,
        acknowledged_at=case when workflow_notifications.status='resolved' then null else workflow_notifications.acknowledged_at end,
        resolved_at=null returning id
    ), resolved as (
      update workflow_notifications n set status='resolved',resolved_at=now(),updated_at=now()
      where n.status<>'resolved' and (${options.orgId ?? null}::uuid is null or n.org_id=${options.orgId ?? null}::uuid)
        and not exists(select 1 from conditions c where c.org_id=n.org_id and c.ticket_id=n.ticket_id and c.kind=n.kind)
      returning id
    ) select (select count(*)::int from upserted) as active_conditions,(select count(*)::int from resolved) as resolved`;
  return { activeConditions:Number(rows[0]?.active_conditions ?? 0),resolved:Number(rows[0]?.resolved ?? 0) };
}

export async function listWorkflowNotifications(orgId: string, options: { includeResolved?: boolean; limit?: number } = {}) {
  if (!hasDatabaseUrl()) return [];
  await ensureWorkflowNotificationSchema();
  const limit = Math.max(1,Math.min(200,Math.floor(options.limit ?? 100) || 100));
  return await getSql()`select n.id::text,n.ticket_id::text,n.kind,n.status,n.severity,n.title,n.message,n.metadata,n.occurrences,
    n.opened_at::text,n.last_seen_at::text,n.acknowledged_at::text,n.resolved_at::text,t.title as ticket_title
    from workflow_notifications n join tickets t on t.id=n.ticket_id and t.org_id=n.org_id
    where n.org_id=${orgId} and (${Boolean(options.includeResolved)} or n.status<>'resolved')
    order by case n.status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
      case n.severity when 'critical' then 0 when 'warning' then 1 else 2 end,n.opened_at desc limit ${limit}`;
}

export async function ackWorkflowNotification(orgId: string, notificationId: string) {
  await ensureWorkflowNotificationSchema();
  const rows = await getSql()`with changed as (
      update workflow_notifications set status='acknowledged',acknowledged_at=now(),updated_at=now()
      where org_id=${orgId} and id=${notificationId} and status='open' returning id,org_id,ticket_id,status
    ), logged as (
      insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'user','ticket',ticket_id,'workflow_notification_acknowledged',jsonb_build_object('notificationId',id) from changed
    ) select id::text,status from changed`;
  if (rows[0]) return rows[0];
  const existing = await getSql()`select id::text,status from workflow_notifications where org_id=${orgId} and id=${notificationId}`;
  if (existing[0]?.status === "acknowledged") return existing[0];
  throw new Error("notification_not_open_or_not_found");
}
