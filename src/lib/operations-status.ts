import { getSql } from "./db";
import { ensureJevSchema } from "./jev-schema";
import { enqueueTicketTriage } from "./jev-assessments";
import { randomUUID } from "node:crypto";
import type { Priority } from "./types";
import { ensureRepairShoprWorkflowSchema } from "./repairshopr-workflow";
import { ensureSyncroWorkflowSchema } from "./syncro-workflow";

export async function getImportBacklogs(orgId: string) {
  await Promise.all([ensureRepairShoprWorkflowSchema(), ensureSyncroWorkflowSchema()]);
  const sql = getSql();
  const [repairshopr,syncro] = await Promise.all([
    sql`select count(*) filter(where pending)::int as pending,count(*) filter(where pending and last_error is not null)::int as failed from repairshopr_import_queue where org_id=${orgId}`,
    sql`select count(*) filter(where pending)::int as pending,count(*) filter(where pending and last_error is not null)::int as failed from syncro_import_queue where org_id=${orgId}`,
  ]);
  const mapped = (rows: Record<string, unknown>[]) => ({ pendingTickets:Number(rows[0]?.pending ?? 0),failedTickets:Number(rows[0]?.failed ?? 0) });
  return { repairshopr:mapped(repairshopr),syncro:mapped(syncro) };
}

export async function operationsOrgId() {
  const rows = await getSql()`select id::text from orgs where name='Default Operations' limit 1`;
  if (!rows[0]) throw new Error("Workspace not initialized");
  return String(rows[0].id);
}

export async function getAssessmentOperations(orgId: string) {
  await ensureJevSchema();
  const sql = getSql();
  const [counts, assessments, age] = await Promise.all([
    sql`select status,count(*)::int as count from jev_assessments where org_id=${orgId} group by status`,
    sql`select a.id::text,a.ticket_id::text,t.ticket_number::text,a.kind,a.status,a.attempt_count,
      a.last_error,a.next_retry_at::text,a.updated_at::text
      from jev_assessments a join tickets t on t.id=a.ticket_id
      where a.org_id=${orgId} and a.status in ('pending','running','retryable','failed','not_configured')
      order by case when a.status='failed' then 0 else 1 end,a.created_at limit 50`,
    sql`select min(created_at)::text as oldest_pending_at from jev_assessments
      where org_id=${orgId} and status in ('pending','running','retryable','not_configured')`,
  ]);
  return { counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])), assessments,
    oldestPendingAt: age[0]?.oldest_pending_at ?? null };
}

export async function retryAssessment(orgId: string, assessmentId: string) {
  await ensureJevSchema();
  const sql = getSql();
  // A single statement both changes state and records who requested recovery.
  const rows = await sql`with retried as (
    update jev_assessments set status='pending',attempt_count=0,next_retry_at=null,
      started_at=null,completed_at=null,updated_at=now()
    where id=${assessmentId}::uuid and org_id=${orgId} and status in ('failed','retryable','not_configured')
    returning id,ticket_id,last_error
  ), logged as (
    insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    select ${orgId},'system','ticket',ticket_id,'manager.assessment.retry',
      jsonb_build_object('assessmentId',id,'previousError',last_error,'actor','manager workspace session') from retried
    returning id
  ) select id::text from retried`;
  if (!rows.length) throw new Error("Assessment is not retryable or no longer exists");
  return { queued: true };
}

export async function retriageTicket(orgId: string, ticketId: string) {
  await ensureJevSchema();
  const sql = getSql();
  const rows = await sql`select title,description,created_from,priority,status from tickets where org_id=${orgId} and id=${ticketId}`;
  const ticket = rows[0];
  if (!ticket || ["resolved", "closed"].includes(ticket.status)) throw new Error("Ticket is missing or completed");
  const assessmentId = await enqueueTicketTriage({ orgId, ticketId,
    ticket: { title: String(ticket.title), description: ticket.description, source: ticket.created_from, severity: ticket.priority },
    fallbackPriority: ticket.priority as Priority, preservePriority: true, preserveAssignment: true,
    idempotencyKey: `manager-retriage:${ticketId}:${randomUUID()}` });
  await sql`insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    values (${orgId},'system','ticket',${ticketId},'manager.triage.requested',${JSON.stringify({ assessmentId, actor: "manager workspace session" })}::jsonb)`;
  return { queued: true, assessmentId };
}

export async function confirmHumanTriage(orgId: string, ticketId: string, reason: string) {
  if (reason.trim().length < 8 || reason.length > 2000) throw new Error("Record a short explanation of the reviewed routing");
  const rows = await getSql()`with changed as (
    update tickets set triage_needs_human=false where org_id=${orgId} and id=${ticketId}
      and triage_needs_human and status not in ('resolved','closed')
      and (assigned_team_id is not null or assigned_user_id is not null) returning id
  ), logged as (
    insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    select ${orgId},'system','ticket',id,'manager.human_triage.confirmed',
      jsonb_build_object('actor','manager workspace session','reason',${reason.trim()}::text) from changed
  ) select id::text from changed`;
  if (!rows.length) throw new Error("Import or assign the reviewed routing first; the ticket must still need human triage");
  return { confirmed: true };
}
