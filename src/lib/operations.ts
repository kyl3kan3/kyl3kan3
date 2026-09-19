import { randomUUID } from "node:crypto";
import {
  addDemoTicketComment,
  createDemoTeam,
  createDemoTicket,
  createDemoUser,
  updateDemoTicket,
} from "./demo-store";
import { getSql, hasDatabaseUrl } from "./db";
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
type CompletionCycleRow = { completion_cycle: number | string };
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
      ${JSON.stringify(metadata)}::jsonb
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
      ${input.reporterEmail ?? null},
      ${input.createdFrom ?? "manual"}
    )
    returning id, ticket_number::text
  `) as TicketIdRow[];

  const ticket = ticketRows[0];

  if (input.comment) {
    await addTicketComment(ticket.id, {
      body: input.comment,
      authorEmail: input.reporterEmail || "operator@example.com",
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
    return updateDemoTicket(ticketId, input);
  }

  const sql = getSql();
  await ensureJevSchema();
  const current = await findTicket(ticketId);

  if (!current) {
    throw new Error("Ticket not found");
  }

  if (input.title !== undefined) {
    if (!input.title) throw new Error("Ticket title cannot be blank");
    await sql`update tickets set title = ${input.title} where id = ${ticketId}`;
  }

  if (input.description !== undefined) {
    await sql`
      update tickets
      set description = ${input.description}
      where id = ${ticketId}
    `;
  }

  let completionCycle = numberValue(current.completion_cycle);
  let shouldReviewCompletion = false;
  let effectiveStatus = current.status;

  if (input.status && input.status !== current.status) {
    if (current.created_from === "repairshopr") {
      throw new Error("RepairShopr ticket status must be updated in RepairShopr");
    }

    const wasComplete =
      current.status === "resolved" || current.status === "closed";
    const willBeComplete =
      input.status === "resolved" || input.status === "closed";
    shouldReviewCompletion = !wasComplete && willBeComplete;
    const isReopening = wasComplete && !willBeComplete;

    const rows = (await sql`
      update tickets
      set
        status = ${input.status},
        completion_cycle = completion_cycle + ${shouldReviewCompletion ? 1 : 0},
        reopened_count = reopened_count + ${isReopening ? 1 : 0},
        resolved_at = case
          when ${shouldReviewCompletion} then now()
          when ${isReopening} then null
          else resolved_at
        end,
        first_response_at = case
          when ${input.status === "in_progress"} then coalesce(first_response_at, now())
          else first_response_at
        end
      where id = ${ticketId}
      returning completion_cycle
    `) as CompletionCycleRow[];
    completionCycle = numberValue(rows[0]?.completion_cycle);
    effectiveStatus = input.status;

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
        ${current.org_id},
        ${ticketId},
        ${current.status},
        ${input.status},
        ${completionCycle},
        'ui',
        ${JSON.stringify({
          completionReviewQueued: shouldReviewCompletion,
          reopened: isReopening,
          ...(shouldReviewCompletion
            ? {
                resolutionSummary: input.resolutionSummary ?? null,
                customerNextSteps: input.customerNextSteps ?? null,
                verificationEvidence: input.verificationEvidence ?? null,
                technicianUserId: current.assigned_user_id,
              }
            : {}),
        })}::jsonb
      )
    `;

    if (current.incident_id) {
      const incidentStatus =
        input.status === "closed"
          ? "closed"
          : input.status === "resolved"
            ? "resolved"
            : "open";

      await sql`
        update incidents
        set status = ${incidentStatus}, last_seen_at = now()
        where id = ${current.incident_id}
      `;
    }
  }

  if (input.priority) {
    const scores = priorityScores(input.priority);
    await sql`
      update tickets
      set
        priority = ${input.priority},
        importance_score = ${scores.importanceScore},
        urgency_score = ${scores.urgencyScore},
        sla_due_at = coalesce(sla_due_at, now() + (${slaMinutes(input.priority)} || ' minutes')::interval)
      where id = ${ticketId}
    `;

    if (current.incident_id) {
      await sql`
        update incidents
        set
          priority = ${input.priority},
          importance_score = ${scores.importanceScore},
          urgency_score = ${scores.urgencyScore},
          last_seen_at = now()
        where id = ${current.incident_id}
      `;
    }
  }

  if (input.assignedTeamId !== undefined || input.assignedUserId !== undefined) {
    const assignedTeamId =
      input.assignedTeamId === undefined
        ? current.assigned_team_id
        : input.assignedTeamId;
    const assignedUserId =
      input.assignedUserId === undefined
        ? current.assigned_user_id
        : input.assignedUserId;
    const humanRouted = Boolean(assignedTeamId || assignedUserId);
    const assignmentStatus =
      humanRouted && ["new", "triaged"].includes(effectiveStatus)
        ? "assigned"
        : effectiveStatus;
    await sql`
      update tickets
      set
        assigned_team_id = ${assignedTeamId},
        assigned_user_id = ${assignedUserId},
        triage_needs_human = case
          when ${humanRouted} then false
          else triage_needs_human
        end,
        status = ${assignmentStatus}
      where id = ${ticketId}
    `;
    if (assignmentStatus !== effectiveStatus) {
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
          ${current.org_id},
          ${ticketId},
          ${effectiveStatus},
          ${assignmentStatus},
          ${completionCycle},
          'ui',
          ${JSON.stringify({ humanRoutingCompleted: true })}::jsonb
        )
      `;
    }
  }

  if (input.comment) {
    await addTicketComment(ticketId, {
      body: input.comment,
      authorEmail: "operator@example.com",
    });
  }

  await writeAudit(current.org_id, ticketId, "ticket.updated", input);

  if (shouldReviewCompletion) {
    try {
      const assessmentId = await createCompletionAssessment({
        orgId: current.org_id,
        ticketId,
        completionCycle,
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
      ${input.authorEmail || "operator@example.com"},
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
        when ${input.countsAsResponse !== false}
          then coalesce(first_response_at, now())
        else first_response_at
      end
    where id = ${ticketId}
  `;

  await writeAudit(current.org_id, ticketId, "ticket.commented", {
    commentId: rows[0].id,
    authorEmail: input.authorEmail || "operator@example.com",
  });

  return rows[0];
}
