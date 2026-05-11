import OpenAI from "openai";
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
};

type RawAiDecision = Omit<
  AlertTriageDecision,
  "model" | "usedAi" | "fallbackReason"
>;

const priorities: Priority[] = ["P1", "P2", "P3", "P4"];
const defaultModel = "gpt-5-mini";
const maxBodyChars = 6000;

const triageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description: "Clear ticket title, 8 to 120 characters.",
    },
    summary: {
      type: "string",
      description: "Concise plain-language ticket description.",
    },
    createdFrom: {
      type: "string",
      enum: ["alert_email", "client_email"],
    },
    service: {
      type: "string",
      description: "Impacted service, product, system, or mailbox.",
    },
    severity: {
      type: "string",
      description: "Severity stated or inferred from the message.",
    },
    priority: {
      type: "string",
      enum: priorities,
    },
    importanceScore: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
    urgencyScore: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
    assignedTeamId: {
      type: "string",
      description: "Must be one of the provided team IDs.",
    },
    assignedUserId: {
      type: "string",
      description: "Must be one of the provided active user IDs.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reasoning: {
      type: "string",
      description: "Short decision rationale. Do not include chain of thought.",
    },
    dedupHint: {
      type: "string",
      description: "Stable phrase useful for grouping similar alerts.",
    },
  },
  required: [
    "title",
    "summary",
    "createdFrom",
    "service",
    "severity",
    "priority",
    "importanceScore",
    "urgencyScore",
    "assignedTeamId",
    "assignedUserId",
    "confidence",
    "reasoning",
    "dedupHint",
  ],
};

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function boundedScore(value: unknown, fallback: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(100, Math.round(next)));
}

function boundedConfidence(value: unknown, fallback: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, next));
}

function asPriority(value: unknown, fallback: Priority): Priority {
  return priorities.includes(value as Priority) ? (value as Priority) : fallback;
}

function priorityFromScores(importanceScore: number, urgencyScore: number) {
  const total = importanceScore + urgencyScore;
  if (total >= 80) return "P1";
  if (total >= 60) return "P2";
  if (total >= 35) return "P3";
  return "P4";
}

function compact(value: string, fallback: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim() || fallback;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength - 1).trim()}...`
    : cleaned;
}

function teamKeywordScore(teamName: string, haystack: string) {
  const name = teamName.toLowerCase();
  let score = 0;

  if (haystack.includes(name)) score += 30;
  if (
    name.includes("database") &&
    /\b(database|db|postgres|neon|sql|query|timeout|connection)\b/.test(haystack)
  ) {
    score += 25;
  }
  if (
    name.includes("security") &&
    /\b(security|auth|login|breach|compliance|token|password|permission)\b/.test(
      haystack,
    )
  ) {
    score += 25;
  }
  if (
    name.includes("messaging") &&
    /\b(email|mail|resend|webhook|inbound|notification|sms|parser)\b/.test(
      haystack,
    )
  ) {
    score += 25;
  }
  if (
    name.includes("platform") &&
    /\b(api|edge|vercel|checkout|deploy|latency|5xx|502|503|payment)\b/.test(
      haystack,
    )
  ) {
    score += 25;
  }

  return score;
}

function leastLoadedTeam(context: AssignmentContext) {
  return [...context.teams].sort((left, right) => {
    if (left.openTickets !== right.openTickets) {
      return left.openTickets - right.openTickets;
    }
    return left.name.localeCompare(right.name);
  })[0];
}

function chooseFallbackTeam(
  alert: NormalizedAlertForTriage,
  context: AssignmentContext,
) {
  if (context.teams.length === 0) return null;

  const haystack = `${alert.subject} ${alert.bodyText} ${alert.service} ${alert.severity} ${alert.recipientEmail ?? ""}`.toLowerCase();
  const ranked = context.teams
    .map((team) => ({
      team,
      score: teamKeywordScore(team.name, haystack),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.team.openTickets !== right.team.openTickets) {
        return left.team.openTickets - right.team.openTickets;
      }
      return left.team.name.localeCompare(right.team.name);
    });

  return ranked[0]?.team ?? leastLoadedTeam(context) ?? null;
}

function chooseOwner(teamId: string, context: AssignmentContext) {
  const teamUsers = context.users.filter((user) => user.teamIds.includes(teamId));
  const candidates = teamUsers.length > 0 ? teamUsers : context.users;
  if (candidates.length === 0) return null;

  const onCall = candidates.filter((user) => user.isOnCall);
  const pool = onCall.length > 0 ? onCall : candidates;
  return [...pool].sort((left, right) => {
    if (left.openTickets !== right.openTickets) {
      return left.openTickets - right.openTickets;
    }
    return (left.fullName ?? left.email).localeCompare(right.fullName ?? right.email);
  })[0];
}

export function validateAiDecision(
  raw: unknown,
  alert: NormalizedAlertForTriage,
  heuristicScore: HeuristicScore,
  context: AssignmentContext,
  model: string,
): AlertTriageDecision | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const assignedTeamId = cleanString(record.assignedTeamId);
  const assignedUserId = cleanString(record.assignedUserId);
  const requestedTeam = context.teams.find((team) => team.id === assignedTeamId);
  const requestedUser = context.users.find((user) => user.id === assignedUserId);

  if (
    !requestedTeam ||
    !requestedUser ||
    !requestedUser.teamIds.includes(requestedTeam.id)
  ) {
    return null;
  }

  const importanceScore = boundedScore(
    record.importanceScore,
    heuristicScore.importanceScore,
  );
  const urgencyScore = boundedScore(record.urgencyScore, heuristicScore.urgencyScore);
  const priority = asPriority(
    record.priority,
    priorityFromScores(importanceScore, urgencyScore),
  );

  return {
    title: compact(cleanString(record.title), alert.subject, 140),
    summary: compact(cleanString(record.summary), alert.bodyText || alert.subject, 4000),
    createdFrom:
      record.createdFrom === "alert_email" || record.createdFrom === "client_email"
        ? record.createdFrom
        : alert.createdFrom,
    service: compact(cleanString(record.service), alert.service, 120),
    severity: compact(cleanString(record.severity), alert.severity, 80),
    priority,
    importanceScore,
    urgencyScore,
    assignedTeamId: requestedTeam.id,
    assignedUserId: requestedUser.id,
    confidence: boundedConfidence(record.confidence, 0.65),
    reasoning: compact(
      cleanString(record.reasoning),
      "AI classified and assigned the incoming email.",
      600,
    ),
    dedupHint: compact(cleanString(record.dedupHint), alert.subject, 180),
    model,
    usedAi: true,
    fallbackReason: null,
  };
}

export function deterministicDecision(
  alert: NormalizedAlertForTriage,
  heuristicScore: HeuristicScore,
  context: AssignmentContext,
  model: string,
  fallbackReason: string,
): AlertTriageDecision {
  const team = chooseFallbackTeam(alert, context);
  const owner = team ? chooseOwner(team.id, context) : null;
  const service = compact(alert.service, team?.name ?? "unknown-service", 120);
  const severity = compact(alert.severity, heuristicScore.priority, 80);

  return {
    title: compact(alert.subject, "Untitled alert", 140),
    summary: compact(alert.bodyText, alert.subject, 4000),
    createdFrom: alert.createdFrom,
    service,
    severity,
    priority: heuristicScore.priority,
    importanceScore: heuristicScore.importanceScore,
    urgencyScore: heuristicScore.urgencyScore,
    assignedTeamId: team?.id ?? "",
    assignedUserId: owner?.id ?? "",
    confidence: team && owner ? 0.45 : 0.2,
    reasoning: team && owner
      ? `Fallback routing selected ${team.name} and ${owner.fullName ?? owner.email}.`
      : "Fallback routing could not find a complete team and owner.",
    dedupHint: compact(`${service} ${alert.subject}`, alert.subject, 180),
    model,
    usedAi: false,
    fallbackReason,
  };
}

function payloadPreview(payload: Record<string, unknown>) {
  const keys = Object.keys(payload).slice(0, 24);
  return {
    keys,
    type: typeof payload.type === "string" ? payload.type : null,
    dataKeys:
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? Object.keys(payload.data as Record<string, unknown>).slice(0, 24)
        : [],
  };
}

export function summarizeAssignmentContext(context: AssignmentContext) {
  return {
    teams: context.teams.map((team) => ({
      id: team.id,
      name: team.name,
      openTickets: team.openTickets,
      urgentTickets: team.urgentTickets,
      members: team.members,
      onCall: team.onCall,
    })),
    users: context.users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      teamIds: user.teamIds,
      isOnCall: user.isOnCall,
      openTickets: user.openTickets,
    })),
  };
}

export async function triageIncomingAlert({
  alert,
  rawPayload,
  heuristicScore,
  context,
}: {
  alert: NormalizedAlertForTriage;
  rawPayload: Record<string, unknown>;
  heuristicScore: HeuristicScore;
  context: AssignmentContext;
}): Promise<AlertTriageDecision> {
  const model = process.env.OPENAI_TRIAGE_MODEL?.trim() || defaultModel;
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return deterministicDecision(
      alert,
      heuristicScore,
      context,
      model,
      "missing_openai_api_key",
    );
  }

  try {
    const client = new OpenAI({ apiKey, timeout: 8000 });
    const response = await client.responses.create({
      model,
      instructions:
        "You classify inbound support and incident emails for a helpdesk. Return only the requested JSON. Use the provided team and user IDs exactly. Always choose one valid team and one valid user. Prefer on-call and low-load users. Keep reasoning brief and never include chain-of-thought.",
      input: JSON.stringify({
        alert: {
          ...alert,
          bodyText: alert.bodyText.slice(0, maxBodyChars),
        },
        rawPayload: payloadPreview(rawPayload),
        heuristicScore,
        assignmentContext: summarizeAssignmentContext(context),
      }),
      max_output_tokens: 900,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "alert_triage_decision",
          strict: true,
          schema: triageSchema,
        },
      },
    });

    const outputText = response.output_text;
    const parsed = JSON.parse(outputText) as RawAiDecision;
    const decision = validateAiDecision(
      parsed,
      alert,
      heuristicScore,
      context,
      model,
    );

    if (!decision) {
      return deterministicDecision(
        alert,
        heuristicScore,
        context,
        model,
        "invalid_ai_assignment",
      );
    }

    return decision;
  } catch (error) {
    console.warn("ai_alert_triage_failed", {
      error: error instanceof Error ? error.message : "unknown",
      model,
    });
    return deterministicDecision(
      alert,
      heuristicScore,
      context,
      model,
      "ai_request_failed",
    );
  }
}
