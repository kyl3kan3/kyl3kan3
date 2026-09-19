import {
  classifyTicketWithJev,
  JEV_TRIAGE_RUBRIC_VERSION,
  type JevAssessmentStatus,
  type JevIssueType,
  type JevTriageResult,
  type JevUrgency,
} from "./jev";
import type { Priority } from "./types";

export type NormalizedAlertForTriage = {
  source: string;
  externalId: string | null;
  senderEmail: string | null;
  recipientEmail: string | null;
  subject: string;
  bodyText: string;
  service: string;
  severity: string;
  createdFrom: "alert_email" | "client_email";
};

export type HeuristicScore = {
  importanceScore: number;
  urgencyScore: number;
  priority: Priority;
};

export type TriageTeam = {
  id: string;
  name: string;
  openTickets: number;
  urgentTickets: number;
  members: number;
  onCall: number;
};

export type TriageUser = {
  id: string;
  email: string;
  fullName: string | null;
  teamIds: string[];
  isOnCall: boolean;
  openTickets: number;
};

export type AssignmentContext = {
  teams: TriageTeam[];
  users: TriageUser[];
};

export type AlertTriageDecision = {
  title: string;
  summary: string;
  createdFrom: "alert_email" | "client_email";
  service: string;
  severity: string;
  priority: Priority;
  importanceScore: number;
  urgencyScore: number;
  assignedTeamId: string;
  assignedUserId: string;
  confidence: number;
  reasoning: string;
  dedupHint: string;
  model: string;
  usedAi: boolean;
  fallbackReason: string | null;
  assessmentStatus: JevAssessmentStatus;
  issueType: JevIssueType | null;
  urgency: JevUrgency | null;
  suggestedTeamId: string | null;
  needsHumanTriage: boolean;
  rubricVersion: typeof JEV_TRIAGE_RUBRIC_VERSION;
  jevResult: JevTriageResult;
};

function compact(
  value: string | null | undefined,
  fallback: string,
  maxLength: number,
) {
  const cleaned = value?.replace(/\s+/g, " ").trim() || fallback;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`
    : cleaned;
}

function chooseOwner(teamId: string, context: AssignmentContext) {
  const teamUsers = context.users.filter((user) => user.teamIds.includes(teamId));
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

export function deterministicDecision(
  alert: NormalizedAlertForTriage,
  heuristicScore: HeuristicScore,
  result: JevTriageResult,
): AlertTriageDecision {
  return {
    title: compact(alert.subject, "Untitled ticket", 140),
    summary: compact(alert.bodyText, alert.subject, 4000),
    createdFrom: alert.createdFrom,
    service: compact(alert.service, "unknown-service", 120),
    severity: compact(alert.severity, heuristicScore.priority, 80),
    priority: heuristicScore.priority,
    importanceScore: heuristicScore.importanceScore,
    urgencyScore: heuristicScore.urgencyScore,
    assignedTeamId: "",
    assignedUserId: "",
    confidence: 0,
    reasoning:
      result.status === "not_configured"
        ? "Jev is not configured, so the ticket was left for human triage."
        : "Jev could not complete the assessment, so the ticket was left for human triage.",
    dedupHint: compact(`${alert.service} ${alert.subject}`, alert.subject, 180),
    model: result.model,
    usedAi: false,
    fallbackReason: result.error,
    assessmentStatus: result.status,
    issueType: null,
    urgency: null,
    suggestedTeamId: null,
    needsHumanTriage: true,
    rubricVersion: result.rubricVersion,
    jevResult: result,
  };
}

export function routeJevTriage(
  alert: NormalizedAlertForTriage,
  heuristicScore: HeuristicScore,
  context: AssignmentContext,
  result: JevTriageResult,
): AlertTriageDecision {
  if (result.status !== "succeeded" || !result.routing) {
    return deterministicDecision(alert, heuristicScore, result);
  }

  const team =
    !result.needsHumanTriage && result.suggestedTeamId
      ? context.teams.find((candidate) => candidate.id === result.suggestedTeamId) ??
        null
      : null;
  const owner = team ? chooseOwner(team.id, context) : null;
  const needsHumanTriage = result.needsHumanTriage || !team;
  const confidence = result.confidences?.minimum ?? 0;
  const routing = needsHumanTriage
    ? {
        priority: heuristicScore.priority,
        importanceScore: heuristicScore.importanceScore,
        urgencyScore: heuristicScore.urgencyScore,
      }
    : result.routing;

  return {
    title: compact(alert.subject, "Untitled ticket", 140),
    summary: compact(alert.bodyText, alert.subject, 4000),
    createdFrom: alert.createdFrom,
    service: compact(alert.service, "unknown-service", 120),
    severity: compact(alert.severity, result.urgency ?? alert.severity, 80),
    priority: routing.priority,
    importanceScore: routing.importanceScore,
    urgencyScore: routing.urgencyScore,
    assignedTeamId: needsHumanTriage ? "" : team?.id ?? "",
    assignedUserId: needsHumanTriage ? "" : owner?.id ?? "",
    confidence,
    reasoning: needsHumanTriage
      ? "Jev classified the ticket, but the confidence or team fit requires human triage; the safe heuristic priority remains in effect."
      : `Jev suggested ${team?.name}; local routing rules set ${result.routing.priority} and selected the available owner.`,
    dedupHint: compact(
      `${result.issueType ?? "other"} ${alert.service} ${alert.subject}`,
      alert.subject,
      180,
    ),
    model: result.model,
    usedAi: true,
    fallbackReason: null,
    assessmentStatus: result.status,
    issueType: result.issueType,
    urgency: result.urgency,
    suggestedTeamId: result.suggestedTeamId,
    needsHumanTriage,
    rubricVersion: result.rubricVersion,
    jevResult: result,
  };
}

export async function triageIncomingAlert({
  alert,
  heuristicScore,
  context,
}: {
  alert: NormalizedAlertForTriage;
  rawPayload: Record<string, unknown>;
  heuristicScore: HeuristicScore;
  context: AssignmentContext;
}): Promise<AlertTriageDecision> {
  const result = await classifyTicketWithJev({
    ticket: {
      title: alert.subject,
      description: alert.bodyText,
      source: alert.source,
      service: alert.service,
      severity: alert.severity,
    },
    teams: context.teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: `${team.name} support queue`,
    })),
  });

  return routeJevTriage(alert, heuristicScore, context, result);
}
