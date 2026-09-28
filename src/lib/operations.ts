import { randomUUID } from "node:crypto";
import {
  addDemoTicketComment,
  createDemoTeam,
  createDemoTicket,
  createDemoUser,
  updateDemoTicket,
} from "./demo-store";
import { getSql, hasDatabaseUrl } from "./db";
import { assertDemoModeAllowed } from "./runtime-mode";
import {
  createCompletionAssessment,
  enqueueTicketTriage,
  processJevAssessment,
} from "./jev-assessments";
import { ensureJevSchema } from "./jev-schema";
import type { Priority, TicketComment, TicketStatus, UserRole } from "./types";

const priorities: Priority[] = ["P1", "P2", "P3", "P4"];
const roles: UserRole[] = ["reporter", "agent", "manager", "admin"];
const statuses: TicketStatus[] = [
  "new",
  "triaged",
  "assigned",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
];

type IdRow = { id: string };
type TicketIdRow = { id: string; ticket_number: string };
type TicketUpdateRow = {
  id: string;
  org_id: string;
  completion_cycle: number | string;
  should_review: boolean;
  assigned_user_id: string | null;
};
type TicketLookupRow = {
  id: string;
  org_id: string;
  incident_id: string | null;
  priority: Priority;
  status: TicketStatus;
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  created_from: string;
  completion_cycle: number | string;
};

export type CreateTicketInput = {
  title: string;
  description?: string | null;
  priority?: Priority;
  reporterEmail?: string | null;
  assignedTeamId?: string | null;
  assignedUserId?: string | null;
  createdFrom?: string | null;
  comment?: string | null;
};

export type UpdateTicketInput = {
  title?: string;
  description?: string | null;
  status?: TicketStatus;
  priority?: Priority;
  assignedTeamId?: string | null;
  assignedUserId?: string | null;
  comment?: string | null;
  resolutionSummary?: string | null;
  customerNextSteps?: string | null;
  verificationEvidence?: string | null;
};

export type AddCommentInput = {
  body: string;
  authorEmail?: string | null;
  countsAsResponse?: boolean;
  createdVia?: TicketComment["createdVia"];
};

export type CreateTeamInput = {
  name: string;
};

export type CreateUserInput = {
  email: string;
  fullName?: string | null;
  role: UserRole;
  teamId?: string | null;
  isOnCall: boolean;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function asPriority(value: unknown, fallback: Priority = "P3"): Priority {
  return priorities.includes(value as Priority) ? (value as Priority) : fallback;
}

function asStatus(value: unknown): TicketStatus | undefined {
  return statuses.includes(value as TicketStatus)
    ? (value as TicketStatus)
    : undefined;
}

function asRole(value: unknown): UserRole {
  return roles.includes(value as UserRole) ? (value as UserRole) : "agent";
}

function asBoolean(value: unknown) {
  return value === true || value === "true" || value === "on";
}

function priorityScores(priority: Priority) {
  if (priority === "P1") return { importanceScore: 45, urgencyScore: 42 };
  if (priority === "P2") return { importanceScore: 35, urgencyScore: 28 };
  if (priority === "P3") return { importanceScore: 20, urgencyScore: 18 };
  return { importanceScore: 10, urgencyScore: 8 };
}

function slaMinutes(priority: Priority) {
  if (priority === "P1") return 5;
  if (priority === "P2") return 15;
  if (priority === "P3") return 60;
  return 240;
}

async function ensureDefaultOrg() {
  const sql = getSql();
  const rows = (await sql`
    insert into orgs (name)
    values ('Default Operations')
    on conflict (name) do update set name = excluded.name
    returning id
  `) as IdRow[];

  return rows[0].id;
}

async function findTicket(ticketId: string) {
  const sql = getSql();
  const rows = (await sql`
    select
      id,
      org_id,
      incident_id,
      priority,
      status,
      assigned_team_id,
      assigned_user_id,
      created_from,
      completion_cycle
    from tickets
    where id = ${ticketId}
    limit 1
  `) as TicketLookupRow[];

  return rows[0] ?? null;
}

async function writeAudit(
  orgId: string,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  const sql = getSql();
  await sql`
    insert into audit_logs (
      org_id,
      actor_type,
      entity_type,
      entity_id,
      action,
      metadata
    )
    values (
      ${orgId},
      'system',
      'ticket',
      ${entityId},
      ${action},
      ${JSON.stringify({ ...metadata, actor: "shared_workspace_session" })}::jsonb
    )
  `;
}

export function parseCreateTicketInput(payload: Record<string, unknown>) {
  const title = cleanString(payload.title);

  if (!title) {
    throw new Error("A ticket title is required");
  }

  return {
    title,
    description: cleanString(payload.description) || null,
    priority: asPriority(payload.priority),
    reporterEmail: cleanString(payload.reporterEmail) || null,
    assignedTeamId: cleanString(payload.assignedTeamId) || null,
    assignedUserId: cleanString(payload.assignedUserId) || null,
    comment: cleanString(payload.comment) || null,
  } satisfies CreateTicketInput;
}

export function parseUpdateTicketInput(payload: Record<string, unknown>) {
  const status = asStatus(payload.status);
  const priority =
    payload.priority === undefined ? undefined : asPriority(payload.priority);

  return {
    title:
      payload.title === undefined ? undefined : cleanString(payload.title),
    description:
      payload.description === undefined
        ? undefined
        : cleanString(payload.description) || null,
    status,
    priority,
    assignedTeamId:
      payload.assignedTeamId === undefined
        ? undefined
        : cleanString(payload.assignedTeamId) || null,
    assignedUserId:
      payload.assignedUserId === undefined
        ? undefined
        : cleanString(payload.assignedUserId) || null,
    comment:
      payload.comment === undefined ? undefined : cleanString(payload.comment),
    resolutionSummary:
      payload.resolutionSummary === undefined
        ? undefined
        : cleanString(payload.resolutionSummary) || null,
    customerNextSteps:
      payload.customerNextSteps === undefined
        ? undefined
        : cleanString(payload.customerNextSteps) || null,
    verificationEvidence:
      payload.verificationEvidence === undefined
        ? undefined
        : cleanString(payload.verificationEvidence) || null,
  } satisfies UpdateTicketInput;
}

export function parseCreateTeamInput(payload: Record<string, unknown>) {
  const name = cleanString(payload.name);

  if (!name) {
    throw new Error("A team name is required");
  }

  return { name } satisfies CreateTeamInput;
}

export function parseCreateUserInput(payload: Record<string, unknown>) {
  const email = cleanString(payload.email).toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required");
  }

  return {
    email,
    fullName: cleanString(payload.fullName) || null,
    role: asRole(payload.role),
    teamId: cleanString(payload.teamId) || null,
    isOnCall: asBoolean(payload.isOnCall),
  } satisfies CreateUserInput;
}

export async function createTeam(input: CreateTeamInput) {
  if (!hasDatabaseUrl()) {
    assertDemoModeAllowed();
    return createDemoTeam(input);
  }

  const sql = getSql();
  const orgId = await ensureDefaultOrg();
  const rows = (await sql`
    insert into teams (org_id, name)
    values (${orgId}, ${input.name})
    on conflict (org_id, name) do update set name = excluded.name
    returning id
  `) as IdRow[];

  return rows[0];
}

export async function createUser(input: CreateUserInput) {
  if (!hasDatabaseUrl()) {
    assertDemoModeAllowed();
    return createDemoUser(input);
  }

  const sql = getSql();
  const orgId = await ensureDefaultOrg();
  const rows = (await sql`
    insert into users (org_id, email, full_name, role, is_active)
    values (${orgId}, ${input.email}, ${input.fullName ?? null}, ${input.role}, true)
    on conflict (org_id, email) do update
      set full_name = excluded.full_name,
          role = excluded.role,
          is_active = true
    returning id
  `) as IdRow[];
  const userId = rows[0].id;

  await sql`delete from team_members where user_id = ${userId}`;

  if (input.teamId) {
    await sql`
      insert into team_members (team_id, user_id, is_on_call)
      values (${input.teamId}, ${userId}, ${input.isOnCall})
      on conflict (team_id, user_id) do update set is_on_call = excluded.is_on_call
    `;
  }

  return { id: userId };
}

export async function createTicket(input: CreateTicketInput) {
  if (!hasDatabaseUrl()) {
    assertDemoModeAllowed();
    return createDemoTicket(input);
  }

  const sql = getSql();
  const orgId = await ensureDefaultOrg();
  await ensureJevSchema();
  const priority = input.priority ?? "P3";
  const scores = priorityScores(priority);

  const incidentRows = (await sql`
    insert into incidents (
      org_id,
      title,
      status,
      dedup_key,
      importance_score,
      urgency_score,
      priority,
      confidence,
      first_seen_at,
      last_seen_at,
      blast_count
    )
    values (
      ${orgId},
      ${input.title},
      'open',
      ${`manual-${randomUUID()}`},
      ${scores.importanceScore},
      ${scores.urgencyScore},
      ${priority},
      0.70,
      now(),
      now(),
      1
    )
    returning id
  `) as IdRow[];

  const incidentId = incidentRows[0].id;
  const ticketRows = (await sql`
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
      response_due_at,
      reporter_email,
      created_from
    )
    values (
      ${orgId},
      ${incidentId},
      ${input.title},
      ${input.description ?? null},
      ${input.assignedUserId || input.assignedTeamId ? "assigned" : "new"},
      ${priority},
      ${scores.importanceScore},
      ${scores.urgencyScore},
      ${input.assignedTeamId ?? null},
      ${input.assignedUserId ?? null},
      now() + (${slaMinutes(priority)} || ' minutes')::interval,
      now() + (${slaMinutes(priority)} || ' minutes')::interval,
      ${input.reporterEmail ?? null},
      ${input.createdFrom ?? "manual"}
    )
    returning id, ticket_number::text
  `) as TicketIdRow[];

  const ticket = ticketRows[0];

  if (input.comment) {
    await addTicketComment(ticket.id, {
      body: input.comment,
      authorEmail: input.reporterEmail || "shared-workspace@session.invalid",
      countsAsResponse: false,
      createdVia: "system",
    });
  }

  await writeAudit(orgId, ticket.id, "ticket.created", {
    priority,
    assignedTeamId: input.assignedTeamId,
    assignedUserId: input.assignedUserId,
  });

  await sql`
    insert into ticket_status_events (
      org_id,
      ticket_id,
      from_status,
      to_status,
      completion_cycle,
      source,
      metadata
    ) values (
      ${orgId},
      ${ticket.id},
      null,
      ${input.assignedUserId || input.assignedTeamId ? "assigned" : "new"},
      0,
      'ui',
      ${JSON.stringify({ createdFrom: input.createdFrom ?? "manual" })}::jsonb
    )
  `;

  try {
    const assessmentId = await enqueueTicketTriage({
      orgId,
      ticketId: ticket.id,
      ticket: {
        title: input.title,
        description: input.description,
        source: input.createdFrom ?? "manual",
      },
      fallbackPriority: priority,
      preservePriority: input.priority !== undefined,
      preserveAssignment: Boolean(input.assignedTeamId || input.assignedUserId),
    });
    if (assessmentId) await processJevAssessment(assessmentId);
  } catch (error) {
    console.warn("jev_ticket_triage_enqueue_failed", {
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return ticket;
}

export async function updateTicket(ticketId: string, input: UpdateTicketInput) {
  if (!hasDatabaseUrl()) {
    assertDemoModeAllowed();
    return updateDemoTicket(ticketId, input);
  }

  const sql = getSql();
  await ensureJevSchema();
  const current = await findTicket(ticketId);

  if (!current) {
    throw new Error("Ticket not found");
  }

  const mirrored = ["repairshopr", "syncro"].includes(current.created_from);
  if (mirrored && (
    (input.status !== undefined && input.status !== current.status) ||
    (input.priority !== undefined && input.priority !== current.priority) ||
    (input.assignedTeamId !== undefined && input.assignedTeamId !== current.assigned_team_id) ||
    (input.assignedUserId !== undefined && input.assignedUserId !== current.assigned_user_id)
  )) {
    throw new Error("Mirrored ticket status, priority, and assignment must be updated in its source system or an explicit writeback workflow");
  }
  if (input.title !== undefined && !input.title) throw new Error("Ticket title cannot be blank");

  const assignmentRequested = input.assignedTeamId !== undefined || input.assignedUserId !== undefined;
  const scores = priorityScores(input.priority ?? current.priority);
  const comment = cleanString(input.comment);
  // The row lock is acquired before deriving the transition. Counters, evidence,
  // status history, incident state, and audit either commit together or not at all.
  const rows = (await sql`
    with locked as materialized (
      select * from tickets where id = ${ticketId} for update
    ), proposed as (
      select locked.*,
        coalesce(${mirrored ? null : input.status ?? null}::text, status) as requested_status,
        case when ${!mirrored && input.assignedTeamId !== undefined}
          then ${input.assignedTeamId ?? null}::uuid else assigned_team_id end as next_team,
        case when ${!mirrored && input.assignedUserId !== undefined}
          then ${input.assignedUserId ?? null}::uuid else assigned_user_id end as next_user
      from locked
    ), planned as (
      select proposed.*,
        case when ${assignmentRequested} and (next_team is not null or next_user is not null)
          and requested_status in ('new','triaged') and not ${mirrored}
          then 'assigned' else requested_status end as next_status
      from proposed
    ), transition as (
      select planned.*,
        status not in ('resolved','closed') and next_status in ('resolved','closed') as should_review,
        status in ('resolved','closed') and next_status not in ('resolved','closed') as reopening
      from planned
    ), changed as (
      update tickets t set
        title = case when ${input.title !== undefined} then ${input.title ?? null} else t.title end,
        description = case when ${input.description !== undefined} then ${input.description ?? null} else t.description end,
        status = transition.next_status,
        priority = coalesce(${mirrored ? null : input.priority ?? null}::text, t.priority),
        importance_score = case when ${!mirrored && input.priority !== undefined} then ${scores.importanceScore} else t.importance_score end,
        urgency_score = case when ${!mirrored && input.priority !== undefined} then ${scores.urgencyScore} else t.urgency_score end,
        assigned_team_id = transition.next_team,
        assigned_user_id = transition.next_user,
        triage_needs_human = case when ${assignmentRequested}
          and (transition.next_team is not null or transition.next_user is not null)
          then false else t.triage_needs_human end,
        completion_cycle = t.completion_cycle + case when transition.should_review then 1 else 0 end,
        reopened_count = t.reopened_count + case when transition.reopening then 1 else 0 end,
        resolved_at = case when transition.should_review then now()
          when transition.reopening then null else t.resolved_at end,
        sla_due_at = case when ${!mirrored && input.priority !== undefined}
          and (t.priority is distinct from ${input.priority ?? null}::text or t.sla_due_at is null)
          then least(t.sla_due_at, t.created_at + (${slaMinutes(input.priority ?? current.priority)} || ' minutes')::interval)
          else t.sla_due_at end,
        response_due_at = case when ${!mirrored && input.priority !== undefined}
          then least(t.response_due_at, t.created_at + (${slaMinutes(input.priority ?? current.priority)} || ' minutes')::interval)
          else t.response_due_at end,
        updated_at = now()
      from transition where t.id = transition.id
      returning t.id, t.org_id, t.incident_id, t.status, t.priority, t.importance_score,
        t.urgency_score, t.assigned_user_id, t.completion_cycle,
        transition.status as previous_status, transition.should_review, transition.reopening
    ), status_event as (
      insert into ticket_status_events (org_id, ticket_id, from_status, to_status, completion_cycle, source, metadata)
      select org_id, id, previous_status, status, completion_cycle, 'ui',
        jsonb_build_object('completionReviewQueued', should_review, 'reopened', reopening,
          'humanRoutingCompleted', ${assignmentRequested}::boolean,
          'resolutionSummary', ${input.resolutionSummary ?? null}::text,
          'customerNextSteps', ${input.customerNextSteps ?? null}::text,
          'verificationEvidence', ${input.verificationEvidence ?? null}::text,
          'technicianUserId', assigned_user_id)
      from changed where status is distinct from previous_status
    ), incident_update as (
      update incidents i set
        status = case when changed.status = 'closed' then 'closed'
          when changed.status = 'resolved' then 'resolved' else 'open' end,
        priority = changed.priority, importance_score = changed.importance_score,
        urgency_score = changed.urgency_score, last_seen_at = now()
      from changed where i.id = changed.incident_id
        and (changed.status is distinct from changed.previous_status or ${input.priority !== undefined})
    ), note as (
      insert into ticket_comments (ticket_id, author_email, body, created_via)
      select id, 'shared-workspace@session.invalid', ${comment}, 'ui' from changed where ${Boolean(comment)}
    ), audit as (
      insert into audit_logs (org_id, actor_type, entity_type, entity_id, action, metadata)
      select org_id, 'system', 'ticket', id, 'ticket.updated', ${JSON.stringify({ ...input, actor: "shared_workspace_session" })}::jsonb from changed
    )
    select id::text, org_id::text, completion_cycle, should_review, assigned_user_id::text from changed
  `) as TicketUpdateRow[];
  const updated = rows[0];
  if (!updated) throw new Error("Ticket not found");

  if (updated.should_review) {
    const completionCycle = numberValue(updated.completion_cycle);
    try {
      const assessmentId = await createCompletionAssessment({
        orgId: updated.org_id,
        ticketId,
        completionCycle,
        technicianUserId: updated.assigned_user_id,
        resolutionSummary: input.resolutionSummary,
        customerNextSteps: input.customerNextSteps,
        verificationEvidence: input.verificationEvidence,
      });
      if (assessmentId) await processJevAssessment(assessmentId);
    } catch (error) {
      console.warn("jev_completion_review_enqueue_failed", {
        ticketId,
        completionCycle,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { id: ticketId };
}

export async function addTicketComment(ticketId: string, input: AddCommentInput) {
  if (!hasDatabaseUrl()) {
    assertDemoModeAllowed();
    return addDemoTicketComment(ticketId, input);
  }

  const body = cleanString(input.body);
  if (!body) {
    throw new Error("A comment body is required");
  }

  const sql = getSql();
  await ensureJevSchema();
  const current = await findTicket(ticketId);
  if (!current) {
    throw new Error("Ticket not found");
  }

  const rows = (await sql`
    insert into ticket_comments (
      ticket_id,
      author_email,
      body,
      created_via
    )
    values (
      ${ticketId},
      ${input.authorEmail || "shared-workspace@session.invalid"},
      ${body},
      ${input.createdVia ?? "ui"}
    )
    returning id
  `) as IdRow[];

  await sql`
    update tickets
    set
      updated_at = now(),
      first_response_at = case
        when ${input.countsAsResponse === true}
          then coalesce(first_response_at, now())
        else first_response_at
      end
    where id = ${ticketId}
  `;

  await writeAudit(current.org_id, ticketId, "ticket.commented", {
    commentId: rows[0].id,
    authorEmail: input.authorEmail || "shared-workspace@session.invalid",
  });

  return rows[0];
}
