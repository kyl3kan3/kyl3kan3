import { getSql, hasDatabaseUrl } from "./db";
import { getDemoDashboardData } from "./demo-store";
import { ensureJevSchema } from "./jev-schema";
import type {
  ManagerQualityData,
  ManagerQualityRow,
  UserRole,
} from "./types";

type QualityRow = {
  technician_id: string;
  technician: string;
  role: UserRole;
  issue_type: string;
  model: string;
  rubric_version: string;
  procedure_version: string;
  handled_tickets: number | string | null;
  median_response_minutes: number | string | null;
  average_response_minutes: number | string | null;
  reopened_tickets: number | string | null;
  reviewed_tickets: number | string | null;
  scored_criteria: number | string | null;
  quality_score: number | string | null;
  evidence_coverage: number | string | null;
  missing_evidence_count: number | string | null;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function nullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function demoQualityData(windowDays: number, dbError?: string): ManagerQualityData {
  const dashboard = getDemoDashboardData(dbError);
  const reviewed = dashboard.tickets.filter(
    (ticket) => ticket.completionReview?.status === "succeeded",
  );
  const rows: ManagerQualityRow[] = reviewed.flatMap((ticket) => {
    const user = dashboard.users.find(
      (candidate) => candidate.id === ticket.assignedUserId,
    );
    const review = ticket.completionReview;
    if (!user || !review) return [];
    const scoredCriteria = review.criteria.filter(
      (criterion) => criterion.score !== null,
    ).length;
    return [
      {
        technicianId: user.id,
        technician: user.fullName ?? user.email,
        role: user.role,
        issueType: ticket.intakeAssessment?.issueType ?? "unclassified",
        model: review.model ?? "demo-jev",
        rubricVersion:
          review.rubricVersion ?? "ticket-completion-review-v1",
        procedureVersion: "company-ticket-completion-v1",
        handledTickets: 1,
        medianResponseMinutes: 8,
        averageResponseMinutes: 8,
        reopenedTickets: 0,
        reopenedRate: 0,
        reviewedTickets: 1,
        scoredCriteria,
        qualityScore: review.overallScore,
        evidenceCoverage: review.evidenceCoverage,
        missingEvidenceCount: review.missingEvidenceCount,
      },
    ];
  });
  const scoredCriteria = rows.reduce(
    (sum, row) => sum + row.scoredCriteria,
    0,
  );
  const missingEvidenceCount = rows.reduce(
    (sum, row) => sum + row.missingEvidenceCount,
    0,
  );

  return {
    source: "demo",
    refreshedAt: new Date().toISOString(),
    windowDays,
    summary: {
      handledTickets: rows.reduce(
        (sum, row) => sum + row.handledTickets,
        0,
      ),
      reviewedTickets: rows.reduce(
        (sum, row) => sum + row.reviewedTickets,
        0,
      ),
      missingEvidenceCount,
      evidenceCoverage:
        scoredCriteria + missingEvidenceCount > 0
          ? Math.round(
              (scoredCriteria / (scoredCriteria + missingEvidenceCount)) *
                10_000,
            ) / 100
          : null,
    },
    rows,
    dbError,
  };
}

export async function getManagerQualityData(
  requestedWindowDays = 30,
): Promise<ManagerQualityData> {
  const windowDays = Math.max(7, Math.min(365, Math.trunc(requestedWindowDays)));
  if (!hasDatabaseUrl()) return demoQualityData(windowDays);

  try {
    await ensureJevSchema();
    const sql = getSql();
    const rows = (await sql`
      with completed_work as (
        select
          submission.id as submission_id,
          submission.technician_user_id::text as technician_id,
          coalesce(submission.technician_name, users.full_name, users.email) as technician,
          coalesce(submission.technician_role, users.role, 'agent') as role,
          coalesce(submission.issue_type, 'unclassified') as issue_type,
          submission.ticket_id,
          tickets.first_response_at,
          tickets.created_at,
          exists (
            select 1
            from ticket_status_events reopen_event
            where reopen_event.ticket_id = submission.ticket_id
              and reopen_event.completion_cycle = submission.completion_cycle
              and reopen_event.changed_at >= submission.submitted_at
              and reopen_event.from_status in ('resolved', 'closed')
              and reopen_event.to_status not in ('resolved', 'closed')
          ) as reopened,
          review.status as review_status,
          coalesce(review.model, 'unknown-model') as model,
          coalesce(review.rubric_version, 'unknown-rubric') as rubric_version,
          coalesce(review.procedure_version, 'unknown-procedure') as procedure_version,
          review.overall_score,
          review.missing_evidence_count
        from ticket_completion_submissions submission
        join tickets on tickets.id = submission.ticket_id
        left join users on users.id = submission.technician_user_id
        left join lateral (
          select
            assessment.status,
            assessment.model,
            assessment.rubric_version,
            assessment.procedure_version,
            assessment.overall_score,
            assessment.missing_evidence_count
          from jev_assessments assessment
          where assessment.completion_submission_id = submission.id
            and assessment.kind = 'completion_review'
          order by assessment.created_at desc
          limit 1
        ) review on true
        where submission.submitted_at >= now() - (${windowDays} || ' days')::interval
          and submission.technician_user_id is not null
      ),
      ticket_work as (
        select
          technician_id,
          technician,
          role,
          issue_type,
          model,
          rubric_version,
          procedure_version,
          ticket_id,
          min(first_response_at) as first_response_at,
          min(created_at) as created_at,
          bool_or(reopened) as reopened,
          count(*) filter (where review_status = 'succeeded')::int as reviewed_count,
          coalesce(sum(
            case
              when review_status = 'succeeded'
                then greatest(0, 3 - missing_evidence_count)
              else 0
            end
          ), 0) as scored_criteria,
          coalesce(sum(
            overall_score * greatest(0, 3 - missing_evidence_count)
          ) filter (where review_status = 'succeeded'), 0) as quality_numerator,
          coalesce(sum(missing_evidence_count)
            filter (where review_status = 'succeeded'), 0) as missing_evidence_count
        from completed_work
        group by
          technician_id,
          technician,
          role,
          issue_type,
          model,
          rubric_version,
          procedure_version,
          ticket_id
      )
      select
        technician_id,
        technician,
        role,
        issue_type,
        model,
        rubric_version,
        procedure_version,
        count(*)::int as handled_tickets,
        percentile_cont(0.5) within group (
          order by extract(epoch from (first_response_at - created_at)) / 60
        ) filter (where first_response_at is not null) as median_response_minutes,
        avg(extract(epoch from (first_response_at - created_at)) / 60)
          filter (where first_response_at is not null) as average_response_minutes,
        count(*) filter (where reopened)::int as reopened_tickets,
        coalesce(sum(reviewed_count), 0)::int as reviewed_tickets,
        coalesce(sum(scored_criteria), 0)::int as scored_criteria,
        case
          when sum(scored_criteria) > 0
          then sum(quality_numerator) / sum(scored_criteria)
          else null
        end as quality_score,
        case
          when sum(reviewed_count) > 0
          then 100.0 * sum(scored_criteria) / (3 * sum(reviewed_count))
          else null
        end as evidence_coverage,
        coalesce(sum(missing_evidence_count), 0)::int as missing_evidence_count
      from ticket_work
      group by
        technician_id,
        technician,
        role,
        issue_type,
        model,
        rubric_version,
        procedure_version
      order by
        lower(technician),
        role,
        issue_type,
        model,
        rubric_version,
        procedure_version
    `) as QualityRow[];

    const mappedRows: ManagerQualityRow[] = rows.map((row) => {
      const handledTickets = toNumber(row.handled_tickets);
      const reopenedTickets = toNumber(row.reopened_tickets);
      return {
        technicianId: row.technician_id,
        technician: row.technician,
        role: row.role,
        issueType: row.issue_type,
        model: row.model,
        rubricVersion: row.rubric_version,
        procedureVersion: row.procedure_version,
        handledTickets,
        medianResponseMinutes: nullableNumber(row.median_response_minutes),
        averageResponseMinutes: nullableNumber(row.average_response_minutes),
        reopenedTickets,
        reopenedRate:
          handledTickets > 0 ? reopenedTickets / handledTickets : null,
        reviewedTickets: toNumber(row.reviewed_tickets),
        scoredCriteria: toNumber(row.scored_criteria),
        qualityScore: nullableNumber(row.quality_score),
        evidenceCoverage: nullableNumber(row.evidence_coverage),
        missingEvidenceCount: toNumber(row.missing_evidence_count),
      };
    });
    const totalScored = mappedRows.reduce(
      (sum, row) => sum + row.scoredCriteria,
      0,
    );
    const totalMissing = mappedRows.reduce(
      (sum, row) => sum + row.missingEvidenceCount,
      0,
    );

    return {
      source: "database",
      refreshedAt: new Date().toISOString(),
      windowDays,
      summary: {
        handledTickets: mappedRows.reduce(
          (sum, row) => sum + row.handledTickets,
          0,
        ),
        reviewedTickets: mappedRows.reduce(
          (sum, row) => sum + row.reviewedTickets,
          0,
        ),
        missingEvidenceCount: totalMissing,
        evidenceCoverage:
          totalScored + totalMissing > 0
            ? Math.round(
                (totalScored / (totalScored + totalMissing)) * 10_000,
              ) / 100
            : null,
      },
      rows: mappedRows,
    };
  } catch (error) {
    return {
      source: "database",
      refreshedAt: new Date().toISOString(),
      windowDays,
      summary: {
        handledTickets: 0,
        reviewedTickets: 0,
        missingEvidenceCount: 0,
        evidenceCoverage: null,
      },
      rows: [],
      dbError:
        error instanceof Error ? error.message : "Unable to load quality metrics",
    };
  }
}
