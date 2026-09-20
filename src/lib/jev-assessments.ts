import { isJevConfigured } from "./jev-config";
import { ensureRepairShoprWorkflowSchema } from "./repairshopr-workflow";
import type { JevWorkHistoryEntry } from "./jev";
import { createHash } from "node:crypto";
import { getSql, hasDatabaseUrl } from "./db";
import {
  classifyTicketWithJev,
  JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
  JEV_DEFAULT_MODEL,
  JEV_TRIAGE_RUBRIC_VERSION,
  reviewCompletedWorkWithJev,
  type JevCompletionReviewInput,
  type JevTeam,
  type JevTicketForTriage,
  type JevTriageResult,
} from "./jev";
import { ensureJevSchema } from "./jev-schema";
import type { Priority, TicketStatus, UserRole } from "./types";

export const JEV_ROUTING_RULE_VERSION = "ticket-routing-v1";

const defaultCompletionProcedures = [
  "Document the reported symptom, relevant diagnosis, work performed, and observed result.",
  "Give the customer a clear resolution or practical next steps, including when to reply or escalate.",
  "Record the verification performed and its result before marking the ticket complete.",
];

type CompletionProcedureSet = {
  version: string;
  source: "configured" | "built_in";
  procedures: string[];
};

type AssessmentStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "retryable"
  | "failed"
  | "not_configured"
  | "superseded";

type AssessmentRow = {
  id: string;
  org_id: string;
  ticket_id: string;
  kind: "triage" | "completion_review";
  completion_cycle: number | string;
  status: AssessmentStatus;
  input_snapshot: unknown;
  attempt_count: number | string;
};

type TicketRoutingRow = {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  importance_score: number | string;
  urgency_score: number | string;
  sla_due_at: string | null;
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  issue_type: string | null;
  completion_cycle: number | string;
  created_from: string;
  created_at: string;
  updated_at: string;
};

type RoutingTeamRow = {
  id: string;
  name: string;
  open_tickets: number | string | null;
};

type RoutingUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  team_ids: string[] | null;
  is_on_call: boolean | null;
  open_tickets: number | string | null;
};

type CompletionTicketRow = TicketRoutingRow & {
  resolved_at: string | null;
  assigned_user_email: string | null;
  assigned_user_name: string | null;
  assigned_user_role: UserRole | null;
};

type IdRow = { id: string };

type TriageSnapshot = {
  type: "triage";
  ticket: JevTicketForTriage;
  teams: JevTeam[];
  fallbackPriority: Priority;
  preservePriority: boolean;
  preserveAssignment: boolean;
};

type CompletionSnapshot = {
  type: "completion_review";
  submissionId: string;
  input: JevCompletionReviewInput;
};

type StoredSnapshot = TriageSnapshot | CompletionSnapshot;

export type EnqueueTriageInput = {
  orgId: string;
  ticketId: string;
  ticket: JevTicketForTriage;
  fallbackPriority: Priority;
  preservePriority?: boolean;
  preserveAssignment?: boolean;
  idempotencyKey?: string;
};

export type PersistCompletedTriageInput = {
  orgId: string;
  ticketId: string;
  idempotencyKey: string;
  ticket: JevTicketForTriage;
  teams: JevTeam[];
  fallbackPriority: Priority;
  result: JevTriageResult;
  routing: {
    priority: Priority;
    assignedTeamId: string | null;
    assignedUserId: string | null;
    needsHumanTriage: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function compactError(value: string | null) {
  if (!value) return null;
  return value.slice(0, 240);
}

function assessmentStatus(error: string | null, attempts: number): AssessmentStatus {
  if (error === "missing_ai_gateway_credentials") return "not_configured";
  const retryable =
    error === "timeout" ||
    error === "request_failed" ||
    error === "http_429" ||
    error === "http_529" ||
    Boolean(error?.match(/^http_5\d\d$/));
  return retryable && attempts < 3 ? "retryable" : "failed";
}

function nextRetryAt(attempts: number) {
  const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function hashSnapshot(snapshot: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 20);
}

function procedureList(value: unknown) {
  if (!Array.isArray(value)) return null;
  const procedures = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 1_500))
    .filter(Boolean)
    .slice(0, 30);
  return procedures.length > 0 ? procedures : null;
}

export function completionProceduresForIssue(
  issueType: string | null,
): CompletionProcedureSet {
  const version =
    process.env.JEV_REVIEW_PROCEDURE_VERSION?.trim() ||
    "company-ticket-completion-v1";
  const configured = process.env.JEV_REVIEW_PROCEDURES_JSON?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as unknown;
      const direct = procedureList(parsed);
      if (direct) return { version, source: "configured", procedures: direct };
      if (isRecord(parsed)) {
        const key = issueType?.trim().toLowerCase() || "default";
        const selected = procedureList(parsed[key]) ?? procedureList(parsed.default);
        if (selected) {
          return { version, source: "configured", procedures: selected };
        }
      }
    } catch {
      console.warn("jev_review_procedures_invalid_json");
    }
  }
  return {
    version,
    source: "built_in",
    procedures: defaultCompletionProcedures,
  };
}

async function routingContext(orgId: string) {
  const sql = getSql();
  const [teamRows, userRows] = await Promise.all([
    sql`
      select
        tm.id::text,
        tm.name,
        count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets
      from teams tm
      left join tickets t on t.assigned_team_id = tm.id
      where tm.org_id = ${orgId}
      group by tm.id, tm.name
      order by tm.name
    `,
    sql`
      select
        u.id::text,
        u.email,
        u.full_name,
        coalesce(array_remove(array_agg(m.team_id::text), null), '{}') as team_ids,
        coalesce(bool_or(m.is_on_call), false) as is_on_call,
        count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets
      from users u
      left join team_members m on m.user_id = u.id
      left join tickets t on t.assigned_user_id = u.id
      where u.org_id = ${orgId} and u.is_active
      group by u.id, u.email, u.full_name
      order by u.full_name nulls last, u.email
    `,
  ]);

  return {
    teams: (teamRows as RoutingTeamRow[]).map((team) => ({
      id: team.id,
      name: team.name,
      description: `${team.name} support queue`,
      openTickets: numberValue(team.open_tickets),
    })),
    users: (userRows as RoutingUserRow[]).map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      teamIds: user.team_ids ?? [],
      isOnCall: Boolean(user.is_on_call),
      openTickets: numberValue(user.open_tickets),
    })),
  };
}

function chooseOwner(
  teamId: string,
  users: Awaited<ReturnType<typeof routingContext>>["users"],
) {
  const teamUsers = users.filter((user) => user.teamIds.includes(teamId));
  if (teamUsers.length === 0) return null;
  const onCall = teamUsers.filter((user) => user.isOnCall);
  const pool = onCall.length > 0 ? onCall : teamUsers;
  return [...pool].sort((left, right) => {
    if (left.openTickets !== right.openTickets) {
      return left.openTickets - right.openTickets;
    }
    return (left.fullName ?? left.email).localeCompare(
      right.fullName ?? right.email,
    );
  })[0];
}

async function findTicket(ticketId: string) {
  const sql = getSql();
  const rows = (await sql`
    select
      id::text,
      org_id::text,
      title,
      description,
      status,
      priority,
      importance_score,
      urgency_score,
      sla_due_at::text,
      assigned_team_id::text,
      assigned_user_id::text,
      issue_type,
      completion_cycle,
      created_from,
      created_at::text,
      updated_at::text
    from tickets
    where id = ${ticketId}
    limit 1
  `) as TicketRoutingRow[];
  return rows[0] ?? null;
}

async function insertAssessment({
  orgId,
  ticketId,
  kind,
  completionCycle,
  completionSubmissionId,
  evaluatedUserId,
  evaluatedRole,
  issueType,
  idempotencyKey,
  snapshot,
  rubricVersion,
  procedureVersion,
  rubric,
}: {
  orgId: string;
  ticketId: string;
  kind: "triage" | "completion_review";
  completionCycle: number;
  completionSubmissionId?: string | null;
  evaluatedUserId?: string | null;
  evaluatedRole?: string | null;
  issueType?: string | null;
  idempotencyKey: string;
  snapshot: StoredSnapshot;
  rubricVersion: string;
  procedureVersion?: string | null;
  rubric?: Record<string, unknown>;
}) {
  const sql = getSql();
  const rows = (await sql`
    insert into jev_assessments (
      org_id,
      ticket_id,
      completion_submission_id,
      kind,
      completion_cycle,
      evaluated_user_id,
      evaluated_role,
      issue_type,
      status,
      idempotency_key,
      input_snapshot,
      model,
      rubric_version,
      procedure_version,
      rubric
    )
    values (
      ${orgId},
      ${ticketId},
      ${completionSubmissionId ?? null},
      ${kind},
      ${completionCycle},
      ${evaluatedUserId ?? null},
      ${evaluatedRole ?? null},
      ${issueType ?? null},
      'pending',
      ${idempotencyKey},
      ${JSON.stringify(snapshot)}::jsonb,
      ${process.env.JEV_MODEL?.trim() || JEV_DEFAULT_MODEL},
      ${rubricVersion},
      ${procedureVersion ?? null},
      ${JSON.stringify(rubric ?? { version: rubricVersion })}::jsonb
    )
    on conflict (idempotency_key) do update
      set updated_at = jev_assessments.updated_at
    returning id::text
  `) as IdRow[];
  return rows[0].id;
}

export async function enqueueTicketTriage(input: EnqueueTriageInput) {
  if (!hasDatabaseUrl()) return null;
  await ensureJevSchema();
  const context = await routingContext(input.orgId);
  const snapshot: TriageSnapshot = {
    type: "triage",
    ticket: input.ticket,
    teams: context.teams.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    fallbackPriority: input.fallbackPriority,
    preservePriority: Boolean(input.preservePriority),
    preserveAssignment: Boolean(input.preserveAssignment),
  };
  const idempotencyKey =
    input.idempotencyKey ??
    `triage:${input.ticketId}:${hashSnapshot(snapshot)}:${JEV_TRIAGE_RUBRIC_VERSION}`;
  return insertAssessment({
    orgId: input.orgId,
    ticketId: input.ticketId,
    kind: "triage",
    completionCycle: 0,
    idempotencyKey,
    snapshot,
    rubricVersion: JEV_TRIAGE_RUBRIC_VERSION,
  });
}

export async function persistCompletedTicketTriage(
  input: PersistCompletedTriageInput,
) {
  if (!hasDatabaseUrl()) return null;
  await ensureJevSchema();
  const sql = getSql();
  const snapshot: TriageSnapshot = {
    type: "triage",
    ticket: input.ticket,
    teams: input.teams,
    fallbackPriority: input.fallbackPriority,
    preservePriority: false,
    preserveAssignment: false,
  };
  const assessmentId = await insertAssessment({
    orgId: input.orgId,
    ticketId: input.ticketId,
    kind: "triage",
    completionCycle: 0,
    idempotencyKey: input.idempotencyKey,
    snapshot,
    rubricVersion: JEV_TRIAGE_RUBRIC_VERSION,
    issueType: input.result.issueType,
  });
  const status: AssessmentStatus =
    input.result.status === "not_configured"
      ? "not_configured"
      : input.result.status === "succeeded"
        ? "succeeded"
        : assessmentStatus(input.result.error, 1);
  const suggestedTeam = input.teams.find(
    (team) => team.id === input.result.suggestedTeamId,
  );
  const resultJson = {
    assessment: {
      issueType: input.result.issueType,
      urgency: input.result.urgency,
      suggestedTeamId: input.result.suggestedTeamId,
      suggestedTeam: suggestedTeam?.name ?? null,
      confidences: input.result.confidences,
      needsHumanTriage: input.routing.needsHumanTriage,
      raw: input.result.rawResponse,
    },
    routing: {
      ruleVersion: JEV_ROUTING_RULE_VERSION,
      priority: input.routing.priority,
      assignedTeamId: input.routing.assignedTeamId,
      assignedUserId: input.routing.assignedUserId,
      needsHumanTriage: input.routing.needsHumanTriage,
    },
  };

  await sql`
    update tickets
    set
      issue_type = ${input.result.issueType},
      triage_confidence = ${input.result.confidences?.minimum ?? null},
      triage_needs_human = ${input.routing.needsHumanTriage}
    where id = ${input.ticketId}
  `;
  await sql`
    insert into ticket_status_events (
      org_id,
      ticket_id,
      from_status,
      to_status,
      completion_cycle,
      source,
      metadata
    )
    select
      ${input.orgId},
      t.id,
      null,
      t.status,
      t.completion_cycle,
      'intake',
      ${JSON.stringify({ assessmentId, createdFrom: input.ticket.source })}::jsonb
    from tickets t
    where t.id = ${input.ticketId}
      and not exists (
        select 1 from ticket_status_events e where e.ticket_id = t.id
      )
  `;
  await sql`
    update jev_assessments
    set
      status = ${status},
      model = ${input.result.model},
      issue_type = ${input.result.issueType},
      result = ${JSON.stringify(resultJson)}::jsonb,
      attempt_count = 1,
      last_error = ${compactError(input.result.error)},
      next_retry_at = ${status === "retryable" ? nextRetryAt(1) : null},
      started_at = now(),
      completed_at = case
        when ${status} in ('succeeded', 'failed', 'not_configured') then now()
        else null
      end
    where id = ${assessmentId}
  `;
  return assessmentId;
}

async function markAssessmentFailure(
  assessment: AssessmentRow,
  error: string | null,
) {
  const sql = getSql();
  const attempts = numberValue(assessment.attempt_count);
  const status = assessmentStatus(error, attempts);
  await sql`
    update jev_assessments
    set
      status = ${status},
      last_error = ${compactError(error)},
      next_retry_at = ${status === "retryable" ? nextRetryAt(attempts) : null},
      completed_at = case when ${status} in ('failed', 'not_configured') then now() else null end
    where id = ${assessment.id}
  `;
  return status;
}

async function processTriageAssessment(
  assessment: AssessmentRow,
  snapshot: TriageSnapshot,
) {
  const sql = getSql();
  const ticketAtStart = await findTicket(assessment.ticket_id);
  if (!ticketAtStart) {
    await markAssessmentFailure(assessment, "ticket_not_found");
    return null;
  }

  const result = await classifyTicketWithJev({
    ticket: snapshot.ticket,
    teams: snapshot.teams,
  });
  if (result.status !== "succeeded" || !result.routing) {
    const status = await markAssessmentFailure(assessment, result.error);
    const latest = await findTicket(assessment.ticket_id);
    if (latest) {
      const preserveAssignment =
        snapshot.preserveAssignment ||
        latest.assigned_team_id !== null ||
        latest.assigned_user_id !== null ||
        !["new", "triaged"].includes(latest.status);
      const nextStatus = ["repairshopr", "syncro"].includes(latest.created_from) ? latest.status : latest.status === "new" ? "triaged" : latest.status;
      const routeRows = (await sql`
        update tickets
        set
          assigned_team_id = case
            when ${preserveAssignment} then assigned_team_id
            else null
          end,
          assigned_user_id = case
            when ${preserveAssignment} then assigned_user_id
            else null
          end,
          status = ${nextStatus}
        where id = ${assessment.ticket_id}
          and updated_at = ${latest.updated_at}::timestamptz
        returning id::text
      `) as IdRow[];
      const routingApplied = routeRows.length > 0;
      await sql`
        update tickets
        set triage_needs_human = case
          when ${routingApplied} then true
          else triage_needs_human
        end
        where id = ${assessment.ticket_id}
      `;
      if (routingApplied && latest.status !== nextStatus) {
        await sql`
          insert into ticket_status_events (
            org_id, ticket_id, from_status, to_status, completion_cycle, source, metadata
          ) values (
            ${assessment.org_id},
            ${assessment.ticket_id},
            ${latest.status},
            ${nextStatus},
            ${numberValue(latest.completion_cycle)},
            'jev',
            ${JSON.stringify({ assessmentId: assessment.id, result: "human_triage" })}::jsonb
          )
        `;
      }
    }
    return { status, result, routing: null };
  }

  const latest = await findTicket(assessment.ticket_id);
  if (!latest) {
    await markAssessmentFailure(assessment, "ticket_not_found");
    return null;
  }
  const context = await routingContext(assessment.org_id);
  const suggestedTeam = context.teams.find(
    (team) => team.id === result.suggestedTeamId,
  );
  const needsHumanTriage = result.needsHumanTriage || !suggestedTeam;
  const automaticTeamId = !needsHumanTriage ? suggestedTeam.id : null;
  const automaticOwner = automaticTeamId
    ? chooseOwner(automaticTeamId, context.users)
    : null;
  const preserveAssignment =
    snapshot.preserveAssignment ||
    latest.assigned_team_id !== null ||
    latest.assigned_user_id !== null ||
    !["new", "triaged"].includes(latest.status);
  const preservePriority =
    snapshot.preservePriority ||
    needsHumanTriage ||
    latest.priority !== snapshot.fallbackPriority ||
    !["new", "triaged"].includes(latest.status);
  const mirrored = ["repairshopr", "syncro"].includes(latest.created_from);
  const assignedTeamId = mirrored ? latest.assigned_team_id ?? automaticTeamId : preserveAssignment
    ? latest.assigned_team_id
    : automaticTeamId;
  const assignedUserId = preserveAssignment
    ? latest.assigned_user_id
    : automaticOwner?.id ?? null;
  const priority = preservePriority ? latest.priority : result.routing.priority;
  const nextStatus = mirrored ? latest.status : needsHumanTriage
    ? latest.status === "new"
      ? "triaged"
      : latest.status
    : assignedTeamId && ["new", "triaged"].includes(latest.status)
      ? "assigned"
      : latest.status;
  const routeRows = (await sql`
    update tickets
    set
      priority = ${priority},
      importance_score = case
        when ${preservePriority} then importance_score
        else ${result.routing.importanceScore}
      end,
      urgency_score = case
        when ${preservePriority} then urgency_score
        else ${result.routing.urgencyScore}
      end,
      assigned_team_id = ${assignedTeamId},
      assigned_user_id = ${assignedUserId},
      sla_due_at = case
        when ${preservePriority} then sla_due_at
        else created_at + (${result.routing.slaMinutes} || ' minutes')::interval
      end,
      status = ${nextStatus}
    where id = ${assessment.ticket_id}
      and updated_at = ${latest.updated_at}::timestamptz
    returning id::text
  `) as IdRow[];
  const routingApplied = routeRows.length > 0;
  const confidence = result.confidences?.minimum ?? null;

  await sql`
    update tickets
    set
      issue_type = ${result.issueType},
      triage_confidence = ${confidence},
      triage_needs_human = case
        when ${routingApplied} then ${needsHumanTriage}
        else triage_needs_human
      end
    where id = ${assessment.ticket_id}
  `;
  const routedTicket = (await findTicket(assessment.ticket_id)) ?? latest;
  const routedTeamId = routedTicket.assigned_team_id;
  const routedUserId = routedTicket.assigned_user_id;
  const routing = {
    ruleVersion: JEV_ROUTING_RULE_VERSION,
    priority: routedTicket.priority,
    importanceScore: routingApplied
      ? numberValue(routedTicket.importance_score)
      : null,
    urgencyScore: routingApplied
      ? numberValue(routedTicket.urgency_score)
      : null,
    slaMinutes: preservePriority ? null : result.routing.slaMinutes,
    assignedTeamId: routedTeamId,
    assignedTeam:
      context.teams.find((team) => team.id === routedTeamId)?.name ?? null,
    assignedUserId: routedUserId,
    assignedUser:
      context.users.find((user) => user.id === routedUserId)?.fullName ??
      context.users.find((user) => user.id === routedUserId)?.email ??
      null,
    needsHumanTriage,
    preservedHumanPriority: preservePriority || !routingApplied,
    preservedHumanAssignment: preserveAssignment || !routingApplied,
    routingApplied,
  };

  if (routingApplied && latest.status !== nextStatus) {
    await sql`
      insert into ticket_status_events (
        org_id, ticket_id, from_status, to_status, completion_cycle, source, metadata
      ) values (
        ${assessment.org_id},
        ${assessment.ticket_id},
        ${latest.status},
        ${nextStatus},
        ${numberValue(latest.completion_cycle)},
        'jev',
        ${JSON.stringify({ assessmentId: assessment.id, ruleVersion: JEV_ROUTING_RULE_VERSION })}::jsonb
      )
    `;
  }

  await sql`
    update jev_assessments
    set
      status = 'succeeded',
      model = ${result.model},
      issue_type = ${result.issueType},
      result = ${JSON.stringify({
        assessment: {
          issueType: result.issueType,
          urgency: result.urgency,
          suggestedTeamId: result.suggestedTeamId,
          suggestedTeam:
            context.teams.find((team) => team.id === result.suggestedTeamId)?.name ??
            null,
          confidences: result.confidences,
          needsHumanTriage,
          raw: result.rawResponse,
        },
        routing,
      })}::jsonb,
      last_error = null,
      next_retry_at = null,
      completed_at = now()
    where id = ${assessment.id}
  `;

  await sql`
    insert into audit_logs (
      org_id, actor_type, entity_type, entity_id, action, metadata
    ) values (
      ${assessment.org_id},
      'system',
      'ticket',
      ${assessment.ticket_id},
      'jev.triage.completed',
      ${JSON.stringify({
        assessmentId: assessment.id,
        model: result.model,
        rubricVersion: result.rubricVersion,
        issueType: result.issueType,
        urgency: result.urgency,
        confidence,
        needsHumanTriage,
        ruleVersion: JEV_ROUTING_RULE_VERSION,
      })}::jsonb
    )
  `;

  return { status: "succeeded" as const, result, routing };
}

async function processCompletionAssessment(
  assessment: AssessmentRow,
  snapshot: CompletionSnapshot,
) {
  const sql = getSql();
  const ticket = await findTicket(assessment.ticket_id);
  if (!ticket) {
    await markAssessmentFailure(assessment, "ticket_not_found");
    return null;
  }
  if (
    numberValue(ticket.completion_cycle) !== numberValue(assessment.completion_cycle) ||
    (ticket.status !== "resolved" && ticket.status !== "closed")
  ) {
    await sql`
      update jev_assessments
      set status = 'superseded', completed_at = now(), last_error = 'ticket_cycle_changed'
      where id = ${assessment.id}
    `;
    return { status: "superseded" as const };
  }

  if (!snapshot.input.ticket.issueType && ticket.issue_type) {
    const procedureSet = completionProceduresForIssue(ticket.issue_type);
    snapshot.input.ticket.issueType = ticket.issue_type;
    snapshot.input.procedures = procedureSet.procedures;
    await sql`update jev_assessments set issue_type=${ticket.issue_type},input_snapshot=${JSON.stringify(snapshot)}::jsonb,
      procedure_version=${procedureSet.version},rubric=${JSON.stringify({version:JEV_COMPLETION_REVIEW_RUBRIC_VERSION,procedureVersion:procedureSet.version,procedures:procedureSet.procedures})}::jsonb where id=${assessment.id}`;
    await sql`update ticket_completion_submissions set issue_type=${ticket.issue_type} where id=${snapshot.submissionId}`;
  }
  const result = await reviewCompletedWorkWithJev(snapshot.input);
  if (result.status !== "succeeded" || !result.dimensions) {
    const status = await markAssessmentFailure(assessment, result.error);
    return { status, result };
  }

  const dimensions = Object.values(result.dimensions);
  const scored = dimensions.filter((dimension) => dimension.score !== null);
  const overallScore =
    scored.length > 0
      ? Math.round(
          (scored.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0) /
            (scored.length * 3)) *
            10_000,
        ) / 100
      : null;
  const evidenceCoverage =
    Math.round((scored.length / dimensions.length) * 10_000) / 100;
  const missingEvidenceCount = dimensions.length - scored.length;

  await sql`
    update jev_assessments
    set
      status = 'succeeded',
      model = ${result.model},
      result = ${JSON.stringify({
        outcome: result.outcome,
        dimensions: result.dimensions,
        raw: result.rawResponse,
      })}::jsonb,
      overall_score = ${overallScore},
      evidence_coverage = ${evidenceCoverage},
      missing_evidence_count = ${missingEvidenceCount},
      last_error = null,
      next_retry_at = null,
      completed_at = now()
    where id = ${assessment.id}
  `;

  await sql`
    insert into audit_logs (
      org_id, actor_type, entity_type, entity_id, action, metadata
    ) values (
      ${assessment.org_id},
      'system',
      'ticket',
      ${assessment.ticket_id},
      'jev.completion_review.completed',
      ${JSON.stringify({
        assessmentId: assessment.id,
        completionCycle: assessment.completion_cycle,
        model: result.model,
        rubricVersion: result.rubricVersion,
        overallScore,
        evidenceCoverage,
        missingEvidenceCount,
      })}::jsonb
    )
  `;

  return {
    status: "succeeded" as const,
    result,
    overallScore,
    evidenceCoverage,
    missingEvidenceCount,
  };
}

export async function processJevAssessment(assessmentId: string) {
  if (!hasDatabaseUrl()) return null;
  await ensureJevSchema();
  const sql = getSql();
  const rows = (await sql`
    update jev_assessments
    set
      status = 'running',
      attempt_count = attempt_count + 1,
      started_at = now(),
      completed_at = null
    where id = ${assessmentId}
      and (
        status in ('pending', 'retryable', 'not_configured')
        or (status = 'running' and started_at < now() - interval '10 minutes')
      )
    returning
      id::text,
      org_id::text,
      ticket_id::text,
      kind,
      completion_cycle,
      status,
      input_snapshot,
      attempt_count
  `) as AssessmentRow[];
  const assessment = rows[0];
  if (!assessment || !isRecord(assessment.input_snapshot)) return null;
  const snapshot = assessment.input_snapshot as StoredSnapshot;

  if (assessment.kind === "triage" && snapshot.type === "triage") {
    return processTriageAssessment(assessment, snapshot);
  }
  if (
    assessment.kind === "completion_review" &&
    snapshot.type === "completion_review"
  ) {
    return processCompletionAssessment(assessment, snapshot);
  }
  await markAssessmentFailure(assessment, "invalid_input_snapshot");
  return null;
}

async function reconcileMissingTriageAssessments(limit: number) {
  const sql = getSql();
  const rows = (await sql`
    select t.id::text
    from tickets t
    where not exists (
      select 1
      from jev_assessments assessment
      where assessment.ticket_id = t.id and assessment.kind = 'triage'
    )
    order by t.created_at
    limit ${limit}
  `) as IdRow[];
  let reconciled = 0;
  for (const row of rows) {
    const ticket = await findTicket(row.id);
    if (!ticket) continue;
    try {
      await enqueueTicketTriage({
        orgId: ticket.org_id,
        ticketId: ticket.id,
        ticket: {
          title: ticket.title,
          description: ticket.description,
          source: ticket.created_from,
          severity: ticket.priority,
        },
        fallbackPriority: ticket.priority,
        preservePriority: true,
        preserveAssignment: Boolean(
          ticket.assigned_team_id || ticket.assigned_user_id,
        ),
        idempotencyKey: `triage:${ticket.id}:reconciled:${JEV_TRIAGE_RUBRIC_VERSION}`,
      });
      reconciled += 1;
    } catch (error) {
      console.warn("jev_triage_reconciliation_failed", {
        ticketId: ticket.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return reconciled;
}

async function reconcileMissingCompletionAssessments(limit: number) {
  const sql = getSql();
  const rows = (await sql`
    select
      t.id::text,
      t.org_id::text,
      t.completion_cycle,
      t.created_from,
      t.description,
      completion_event.metadata
    from tickets t
    left join lateral (
      select event.metadata
      from ticket_status_events event
      where event.ticket_id = t.id
        and event.completion_cycle = t.completion_cycle
        and event.to_status in ('resolved', 'closed')
      order by event.changed_at desc
      limit 1
    ) completion_event on true
    where t.status in ('resolved', 'closed')
      and t.completion_cycle > 0
      and not exists (
        select 1
        from jev_assessments assessment
        where assessment.ticket_id = t.id
          and assessment.kind = 'completion_review'
          and assessment.completion_cycle = t.completion_cycle
      )
    order by t.resolved_at nulls last, t.updated_at
    limit ${limit}
  `) as Array<{
    id: string;
    org_id: string;
    completion_cycle: number | string;
    created_from: string;
    description: string | null;
    metadata: unknown;
  }>;
  let reconciled = 0;
  for (const row of rows) {
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    try {
      await createCompletionAssessment({
        orgId: row.org_id,
        ticketId: row.id,
        completionCycle: numberValue(row.completion_cycle),
        resolutionSummary:
          typeof metadata.resolutionSummary === "string"
            ? metadata.resolutionSummary
            : row.created_from === "syncro"
              ? row.description
              : null,
        customerNextSteps:
          typeof metadata.customerNextSteps === "string"
            ? metadata.customerNextSteps
            : null,
        verificationEvidence:
          typeof metadata.verificationEvidence === "string"
            ? metadata.verificationEvidence
            : null,
        technicianUserId:
          row.created_from === "syncro"
            ? null
            : Object.prototype.hasOwnProperty.call(
                  metadata,
                  "technicianUserId",
                )
              ? typeof metadata.technicianUserId === "string"
                ? metadata.technicianUserId
                : null
              : undefined,
      });
      reconciled += 1;
    } catch (error) {
      console.warn("jev_completion_reconciliation_failed", {
        ticketId: row.id,
        completionCycle: row.completion_cycle,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return reconciled;
}

export async function processQueuedJevAssessments(limit = 5) {
  if (!hasDatabaseUrl()) return { processed: 0 };
  await ensureJevSchema();
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  const [triageReconciled, completionReconciled] = await Promise.all([
    reconcileMissingTriageAssessments(safeLimit),
    reconcileMissingCompletionAssessments(safeLimit),
  ]);
  const rows = (await sql`
    select id::text
    from jev_assessments
    where (
      status = 'pending'
      or (status = 'retryable' and coalesce(next_retry_at, now()) <= now())
      or (status = 'not_configured' and ${isJevConfigured()})
      or (status = 'running' and started_at < now() - interval '10 minutes')
    )
    order by created_at
    limit ${safeLimit}
  `) as IdRow[];
  let processed = 0;
  for (const row of rows) {
    if (await processJevAssessment(row.id)) processed += 1;
  }
  return { processed, triageReconciled, completionReconciled };
}

export async function createCompletionAssessment({
  orgId,
  ticketId,
  completionCycle,
  resolutionSummary,
  customerNextSteps,
  verificationEvidence,
  technicianUserId,
}: {
  orgId: string;
  ticketId: string;
  completionCycle: number;
  resolutionSummary?: string | null;
  customerNextSteps?: string | null;
  verificationEvidence?: string | null;
  technicianUserId?: string | null;
}) {
  if (!hasDatabaseUrl()) return null;
  await ensureJevSchema();
  const sql = getSql();
  const hasTechnicianSnapshot = technicianUserId !== undefined;
  const ticketRows = (await sql`
    select
      t.id::text,
      t.org_id::text,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.assigned_team_id::text,
      u.id::text as assigned_user_id,
      t.issue_type,
      t.completion_cycle,
      t.created_from,
      t.created_at::text,
      t.resolved_at::text,
      u.email as assigned_user_email,
      u.full_name as assigned_user_name,
      u.role as assigned_user_role
    from tickets t
    left join users u on u.id = case
      when ${hasTechnicianSnapshot} then ${technicianUserId ?? null}::uuid
      else t.assigned_user_id
    end
    where t.id = ${ticketId} and t.org_id = ${orgId}
    limit 1
  `) as CompletionTicketRow[];
  const ticket = ticketRows[0];
  if (!ticket) throw new Error("Ticket not found");

  const submissionRows = (await sql`
    insert into ticket_completion_submissions (
      org_id,
      ticket_id,
      completion_cycle,
      technician_user_id,
      technician_name,
      technician_role,
      technician_snapshot,
      issue_type,
      resolution_summary,
      customer_next_steps,
      verification_evidence,
      submitted_at
    ) values (
      ${orgId},
      ${ticketId},
      ${completionCycle},
      ${ticket.assigned_user_id},
      ${ticket.assigned_user_name ?? ticket.assigned_user_email},
      ${ticket.assigned_user_role},
      ${JSON.stringify({
        id: ticket.assigned_user_id,
        name: ticket.assigned_user_name,
        email: ticket.assigned_user_email,
        role: ticket.assigned_user_role,
        attributionSource: "assigned_user_at_completion",
      })}::jsonb,
      ${ticket.issue_type},
      ${resolutionSummary?.trim() || null},
      ${customerNextSteps?.trim() || null},
      ${verificationEvidence?.trim() || null},
      coalesce(${ticket.resolved_at}::timestamptz,now())
    )
    on conflict (ticket_id, completion_cycle) do update
      set resolution_summary = excluded.resolution_summary,
          customer_next_steps = excluded.customer_next_steps,
          verification_evidence = excluded.verification_evidence
    returning id::text
  `) as IdRow[];
  const submissionId = submissionRows[0].id;

  const cycleStartRows = (await sql`
    select coalesce(
      (
        select max(event.changed_at)
        from ticket_status_events event
        where event.ticket_id = t.id
          and event.completion_cycle = ${Math.max(0, completionCycle - 1)}
          and event.from_status in ('resolved', 'closed')
          and event.to_status not in ('resolved', 'closed')
      ),
      t.created_at
    )::text as cycle_started_at
    from tickets t
    where t.id = ${ticketId}
  `) as Array<{ cycle_started_at: string }>;
  const cycleStartedAt = cycleStartRows[0]?.cycle_started_at ?? ticket.created_at;

  let importedHistory: JevWorkHistoryEntry[] = [];
  if (ticket.created_from === "repairshopr") {
    await ensureRepairShoprWorkflowSchema();
    const imported = await sql`select repairshopr_evidence from tickets where id=${ticketId}`;
    const evidence = imported[0]?.repairshopr_evidence;
    if (Array.isArray(evidence)) importedHistory = evidence.filter((entry): entry is JevWorkHistoryEntry =>
      isRecord(entry) && typeof entry.at === "string" && typeof entry.action === "string" && new Date(entry.at).getTime() >= new Date(cycleStartedAt).getTime());
  }

  const [commentRows, eventRows] = await Promise.all([
    sql`
      select
        created_at::text as at,
        author_email,
        created_via,
        body as evidence
      from ticket_comments
      where ticket_id = ${ticketId}
        and created_at >= ${cycleStartedAt}::timestamptz
      order by created_at desc, id desc
      limit 120
    `,
    sql`
      select changed_at::text as at, source as actor,
        concat('Status changed from ', coalesce(from_status, 'none'), ' to ', to_status) as evidence
      from ticket_status_events
      where ticket_id = ${ticketId}
        and completion_cycle <= ${completionCycle}
        and changed_at >= ${cycleStartedAt}::timestamptz
      order by changed_at desc, id desc
      limit 120
    `,
  ]);
  const commentHistory = commentRows as Array<{
    at: string;
    author_email: string | null;
    created_via: string | null;
    evidence: string | null;
  }>;
  const eventHistory = eventRows as Array<{
    at: string;
    actor: string | null;
    evidence: string | null;
  }>;
  const completedAt = new Date().toISOString();
  const procedureSet = completionProceduresForIssue(ticket.issue_type);
  const input: JevCompletionReviewInput = {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      issueType: ticket.issue_type,
    },
    procedures: procedureSet.procedures,
    history: [
      ...importedHistory,
      ...eventHistory.map((entry) => ({
        ...entry,
        actor: "system",
        action: "status_change",
      })),
      ...commentHistory.map((entry) => ({
        at: entry.at,
        evidence: entry.evidence,
        actor:
          entry.created_via === "ui" ||
          (entry.author_email &&
            entry.author_email.toLowerCase() ===
              ticket.assigned_user_email?.toLowerCase())
            ? "internal technician note"
            : "customer or external participant",
        action: "ticket_note",
      })),
      {
        at: completedAt,
        action: "resolution_summary",
        actor: "technician",
        evidence: resolutionSummary?.trim() || null,
      },
      {
        at: completedAt,
        action: "customer_next_steps",
        actor: "technician",
        evidence: customerNextSteps?.trim() || null,
      },
      {
        at: completedAt,
        action: "verification",
        actor: "technician",
        evidence: verificationEvidence?.trim() || null,
      },
    ].sort((left, right) => left.at.localeCompare(right.at)),
  };
  const snapshot: CompletionSnapshot = {
    type: "completion_review",
    submissionId,
    input,
  };
  const assessmentId = await insertAssessment({
    orgId,
    ticketId,
    kind: "completion_review",
    completionCycle,
    completionSubmissionId: submissionId,
    evaluatedUserId: ticket.assigned_user_id,
    evaluatedRole: ticket.assigned_user_role,
    issueType: ticket.issue_type,
    idempotencyKey: `completion:${ticketId}:${completionCycle}:${JEV_COMPLETION_REVIEW_RUBRIC_VERSION}`,
    snapshot,
    rubricVersion: JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
    procedureVersion: procedureSet.version,
    rubric: {
      version: JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
      procedureVersion: procedureSet.version,
      procedureSource: procedureSet.source,
      procedures: procedureSet.procedures,
    },
  });
  return assessmentId;
}

export function getJevIntegrationStatus() {
  const procedures = completionProceduresForIssue(null);
  return {
    configured: isJevConfigured(),
    model: process.env.JEV_MODEL?.trim() || JEV_DEFAULT_MODEL,
    triageRubricVersion: JEV_TRIAGE_RUBRIC_VERSION,
    completionRubricVersion: JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
    procedureVersion: procedures.version,
    customProceduresConfigured: procedures.source === "configured",
  };
}
