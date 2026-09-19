import type { Priority } from "./types";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_TRIAGE_RUBRIC_VERSION = "ticket-triage-v1";
export const JEV_COMPLETION_REVIEW_RUBRIC_VERSION =
  "ticket-completion-review-v1";
export const JEV_DEFAULT_MODEL = "jev-latest";
export const JEV_DEFAULT_TIMEOUT_MS = 10_000;
export const JEV_DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD = 0.35;
export const JEV_DEFAULT_EVIDENCE_THRESHOLD = 0.65;
export const JEV_REVIEW_PASS_SCORE = 2;

const MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 300;
const HUMAN_TRIAGE_PROBABILITY_THRESHOLD = 0.5;
const MANUAL_TEAM_OPTION = "manual_triage";

export type JevAssessmentStatus =
  | "succeeded"
  | "not_configured"
  | "failed";

export type JevIssueType =
  | "account_access"
  | "hardware"
  | "software"
  | "network"
  | "security"
  | "billing"
  | "monitoring_alert"
  | "other";

export type JevUrgency = "critical" | "high" | "normal" | "low";

export type JevTeam = {
  id: string;
  name: string;
  description?: string | null;
};

export type JevTicketForTriage = {
  title: string;
  description?: string | null;
  source?: string | null;
  service?: string | null;
  severity?: string | null;
  reporterEmail?: string | null;
};

export type JevTriageInput = {
  ticket: JevTicketForTriage;
  teams: JevTeam[];
};

export type JevRoutingPolicy = {
  priority: Priority;
  importanceScore: number;
  urgencyScore: number;
  slaMinutes: number;
};

export type JevTriageConfidences = {
  issueType: number;
  urgency: number;
  suggestedTeam: number;
  minimum: number;
  humanTriageProbability: number;
};

export type JevTriageResult = {
  status: JevAssessmentStatus;
  model: string;
  rubricVersion: typeof JEV_TRIAGE_RUBRIC_VERSION;
  issueType: JevIssueType | null;
  urgency: JevUrgency | null;
  suggestedTeamId: string | null;
  confidences: JevTriageConfidences | null;
  needsHumanTriage: boolean;
  routing: JevRoutingPolicy | null;
  rawResponse: unknown | null;
  error: string | null;
};

export type JevWorkHistoryEntry = {
  at: string;
  action: string;
  actor?: string | null;
  evidence?: string | null;
};

export type JevCompletionReviewInput = {
  ticket: {
    id?: string;
    title: string;
    description?: string | null;
    issueType?: JevIssueType | string | null;
  };
  history: JevWorkHistoryEntry[];
  procedures: string[];
};

export type JevReviewOutcome = "met" | "not_met" | "missing_evidence";
export type JevReviewDimension =
  | "documentation"
  | "customerNextSteps"
  | "verification";

export type JevReviewDimensionResult = {
  outcome: JevReviewOutcome;
  evidenceProbability: number;
  score: number | null;
  confidence: number;
};

export type JevCompletionReviewResult = {
  status: JevAssessmentStatus;
  model: string;
  rubricVersion: typeof JEV_COMPLETION_REVIEW_RUBRIC_VERSION;
  outcome: JevReviewOutcome | null;
  dimensions: Record<JevReviewDimension, JevReviewDimensionResult> | null;
  rawResponse: unknown | null;
  error: string | null;
};

type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

type JevRequest = {
  state: Record<string, unknown>;
  model: string;
  questions: Record<string, JevQuestion>;
};

type ChoiceAnswer = {
  choice: string;
  confidence: number;
};

type ScoreAnswer = {
  score: number;
  confidence: number;
};

class JevRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "JevRequestError";
  }
}

const issueTypes: JevIssueType[] = [
  "account_access",
  "hardware",
  "software",
  "network",
  "security",
  "billing",
  "monitoring_alert",
  "other",
];

const urgencies: JevUrgency[] = ["critical", "high", "normal", "low"];

const issueTypeCriteria: Record<JevIssueType, string> = {
  account_access:
    "Login, password, permissions, account provisioning, or access issue.",
  hardware: "Physical device, workstation, peripheral, or equipment issue.",
  software:
    "Application, operating system, integration, configuration, or software defect.",
  network:
    "Connectivity, DNS, VPN, Wi-Fi, firewall, latency, or network service issue.",
  security:
    "Suspected compromise, malware, phishing, exposed secret, or security policy issue.",
  billing: "Invoice, payment, subscription, quote, or account billing issue.",
  monitoring_alert:
    "Automated monitoring or observability alert about service health.",
  other: "A support issue that does not clearly fit the other categories.",
};

const urgencyCriteria: Record<JevUrgency, string> = {
  critical:
    "Widespread outage, active security event, severe safety risk, or business-critical work stopped with no workaround.",
  high:
    "Major impact to one or more users, important work blocked, or time-sensitive degradation with limited workaround.",
  normal:
    "Meaningful issue with a workaround or limited impact; normal business response is appropriate.",
  low: "Question, minor inconvenience, routine request, or planned work with little time pressure.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function boundedProbability(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function compact(value: string | null | undefined, maxLength: number) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function redactForJev(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      "[PRIVATE_KEY_REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(password|passwd|secret|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|authorization)(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[EMAIL_REDACTED]",
    )
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN_REDACTED]")
    .replace(
      /\b(?:\d[ -]*?){13,19}\b/g,
      (candidate) =>
        candidate.replace(/\d(?=(?:\D*\d){4})/g, "•"),
    );
}

function externalText(value: string | null | undefined, maxLength: number) {
  return compact(redactForJev(value), maxLength);
}

function envNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function modelFromEnvironment() {
  return process.env.JEV_MODEL?.trim() || JEV_DEFAULT_MODEL;
}

function normalizeTeams(teams: JevTeam[]) {
  const seen = new Set<string>();
  return teams
    .map((team) => ({
      id: team.id.trim(),
      name: compact(team.name, 160),
      description: compact(team.description, 500),
    }))
    .filter((team) => {
      if (!team.id || !team.name || seen.has(team.id)) return false;
      seen.add(team.id);
      return true;
    })
    .slice(0, 19);
}

function teamOptions(teams: JevTeam[]) {
  const normalized = normalizeTeams(teams);
  const optionToTeam = new Map<string, string>();
  const criteria: Record<string, string> = {};

  normalized.forEach((team, index) => {
    const option = `team_${index + 1}`;
    optionToTeam.set(option, team.id);
    criteria[option] = team.description
      ? `${team.name}: ${team.description}`
      : team.name;
  });
  criteria[MANUAL_TEAM_OPTION] =
    "None of the listed teams is a clear fit; a human should choose the queue.";

  return { normalized, optionToTeam, criteria };
}

export function routingFromUrgency(urgency: JevUrgency): JevRoutingPolicy {
  if (urgency === "critical") {
    return {
      priority: "P1",
      importanceScore: 45,
      urgencyScore: 42,
      slaMinutes: 5,
    };
  }
  if (urgency === "high") {
    return {
      priority: "P2",
      importanceScore: 35,
      urgencyScore: 28,
      slaMinutes: 15,
    };
  }
  if (urgency === "normal") {
    return {
      priority: "P3",
      importanceScore: 20,
      urgencyScore: 18,
      slaMinutes: 60,
    };
  }
  return {
    priority: "P4",
    importanceScore: 10,
    urgencyScore: 8,
    slaMinutes: 240,
  };
}

function choiceAnswer(value: unknown): ChoiceAnswer | null {
  if (!isRecord(value) || value.type !== "choice") return null;
  const choice = asTrimmedString(value.choice);
  const confidence = boundedProbability(value.confidence);
  if (!choice || confidence === null) return null;
  return { choice, confidence };
}

function noulAnswer(value: unknown) {
  if (!isRecord(value) || value.type !== "noul") return null;
  return boundedProbability(value.noul);
}

function scoreAnswer(value: unknown): ScoreAnswer | null {
  if (!isRecord(value) || value.type !== "score") return null;
  const score = boundedNumber(value.score, 0, 3);
  const confidence = boundedProbability(value.confidence);
  if (score === null || confidence === null) return null;
  return { score, confidence };
}

function failedTriage(
  model: string,
  error: string,
  rawResponse: unknown | null,
): JevTriageResult {
  return {
    status: "failed",
    model,
    rubricVersion: JEV_TRIAGE_RUBRIC_VERSION,
    issueType: null,
    urgency: null,
    suggestedTeamId: null,
    confidences: null,
    needsHumanTriage: true,
    routing: null,
    rawResponse,
    error,
  };
}

export function parseJevTriageResponse(
  rawResponse: unknown,
  teams: JevTeam[],
  confidenceThreshold = JEV_DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD,
  fallbackModel = JEV_DEFAULT_MODEL,
): JevTriageResult {
  if (!isRecord(rawResponse) || !isRecord(rawResponse.answers)) {
    return failedTriage(fallbackModel, "invalid_response", rawResponse);
  }

  const model = asTrimmedString(rawResponse.model) ?? fallbackModel;
  const issueTypeAnswer = choiceAnswer(rawResponse.answers.issue_type);
  const urgencyAnswer = choiceAnswer(rawResponse.answers.urgency);
  const teamAnswer = choiceAnswer(rawResponse.answers.suggested_team);
  const humanTriageProbability = noulAnswer(rawResponse.answers.human_triage);
  const { normalized, optionToTeam } = teamOptions(teams);

  if (
    normalized.length === 0 ||
    !issueTypeAnswer ||
    !urgencyAnswer ||
    !teamAnswer ||
    humanTriageProbability === null ||
    !issueTypes.includes(issueTypeAnswer.choice as JevIssueType) ||
    !urgencies.includes(urgencyAnswer.choice as JevUrgency) ||
    (teamAnswer.choice !== MANUAL_TEAM_OPTION &&
      !optionToTeam.has(teamAnswer.choice))
  ) {
    return failedTriage(model, "invalid_response", rawResponse);
  }

  const issueType = issueTypeAnswer.choice as JevIssueType;
  const urgency = urgencyAnswer.choice as JevUrgency;
  const suggestedTeamId = optionToTeam.get(teamAnswer.choice) ?? null;
  const threshold =
    confidenceThreshold >= 0 && confidenceThreshold <= 1
      ? confidenceThreshold
      : JEV_DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD;
  const minimum = Math.min(
    issueTypeAnswer.confidence,
    urgencyAnswer.confidence,
    teamAnswer.confidence,
  );
  const needsHumanTriage =
    suggestedTeamId === null ||
    minimum < threshold ||
    humanTriageProbability >= HUMAN_TRIAGE_PROBABILITY_THRESHOLD;

  return {
    status: "succeeded",
    model,
    rubricVersion: JEV_TRIAGE_RUBRIC_VERSION,
    issueType,
    urgency,
    suggestedTeamId,
    confidences: {
      issueType: issueTypeAnswer.confidence,
      urgency: urgencyAnswer.confidence,
      suggestedTeam: teamAnswer.confidence,
      minimum,
      humanTriageProbability,
    },
    needsHumanTriage,
    routing: routingFromUrgency(urgency),
    rawResponse,
    error: null,
  };
}

function buildTriageRequest(input: JevTriageInput, model: string): JevRequest | null {
  const { normalized, criteria } = teamOptions(input.teams);
  if (normalized.length === 0) return null;

  return {
    model,
    state: {
      ticket: {
        title: externalText(input.ticket.title, 300),
        description: externalText(input.ticket.description, 12_000),
        source: externalText(input.ticket.source, 120),
        service: externalText(input.ticket.service, 160),
        stated_severity: externalText(input.ticket.severity, 120),
      },
      available_teams: normalized.map((team) => ({
        id: team.id,
        name: team.name,
        description: team.description || undefined,
      })),
    },
    questions: {
      issue_type: {
        type: "choice",
        instructions:
          "Classify the ticket by its primary issue type. Use only the supplied criteria.",
        criteria: issueTypeCriteria,
      },
      urgency: {
        type: "choice",
        instructions:
          "Classify urgency from customer and operational impact. Do not choose an SLA or assignee.",
        criteria: urgencyCriteria,
      },
      suggested_team: {
        type: "choice",
        instructions:
          "Which available team is the best functional fit? Choose manual_triage when the evidence is ambiguous or no team clearly fits.",
        criteria,
      },
      human_triage: {
        type: "noul",
        instructions:
          "A human should review this classification before routing because the ticket is ambiguous, conflicting, lacks necessary context, or does not clearly fit an available team.",
        criteria: {
          true: "Human triage is needed before routing.",
          false: "The ticket can be routed from the available evidence.",
        },
      },
    },
  };
}

function retryDelay(response: Response) {
  const header = response.headers.get("retry-after");
  if (!header) return DEFAULT_RETRY_DELAY_MS;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1_000));
  }

  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now()));
  }

  return DEFAULT_RETRY_DELAY_MS;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 529 || (status >= 500 && status <= 599);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function postToJev(
  request: JevRequest,
  apiKey: string,
  timeoutMs: number,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt === 0 && isRetryableStatus(response.status)) {
          await wait(retryDelay(response));
          continue;
        }
        throw new JevRequestError(`http_${response.status}`);
      }

      try {
        return (await response.json()) as unknown;
      } catch {
        throw new JevRequestError("invalid_json");
      }
    } catch (error) {
      if (error instanceof JevRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new JevRequestError("timeout");
      }
      throw new JevRequestError("request_failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new JevRequestError("request_failed");
}

export async function classifyTicketWithJev(
  input: JevTriageInput,
): Promise<JevTriageResult> {
  const model = modelFromEnvironment();
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();

  if (!apiKey) {
    return {
      ...failedTriage(model, "missing_typesafe_api_key", null),
      status: "not_configured",
    };
  }
  if (typeof window !== "undefined") {
    return failedTriage(model, "server_runtime_required", null);
  }

  const request = buildTriageRequest(input, model);
  if (!request) return failedTriage(model, "no_available_teams", null);

  try {
    const rawResponse = await postToJev(
      request,
      apiKey,
      envNumber("JEV_TIMEOUT_MS", JEV_DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    );
    return parseJevTriageResponse(
      rawResponse,
      input.teams,
      envNumber(
        "JEV_TRIAGE_CONFIDENCE_THRESHOLD",
        JEV_DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD,
        0,
        1,
      ),
      model,
    );
  } catch (error) {
    return failedTriage(
      model,
      error instanceof JevRequestError ? error.code : "request_failed",
      null,
    );
  }
}

function failedReview(
  model: string,
  error: string,
  rawResponse: unknown | null,
): JevCompletionReviewResult {
  return {
    status: "failed",
    model,
    rubricVersion: JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
    outcome: null,
    dimensions: null,
    rawResponse,
    error,
  };
}

export function evaluateReviewDimension(
  evidenceProbability: number,
  score: number,
  confidence: number,
  evidenceThreshold = JEV_DEFAULT_EVIDENCE_THRESHOLD,
): JevReviewDimensionResult {
  const threshold =
    evidenceThreshold >= 0 && evidenceThreshold <= 1
      ? evidenceThreshold
      : JEV_DEFAULT_EVIDENCE_THRESHOLD;

  if (evidenceProbability < threshold) {
    return {
      outcome: "missing_evidence",
      evidenceProbability,
      score: null,
      confidence,
    };
  }

  return {
    outcome: score >= JEV_REVIEW_PASS_SCORE ? "met" : "not_met",
    evidenceProbability,
    score,
    confidence,
  };
}

export function parseJevCompletionReviewResponse(
  rawResponse: unknown,
  evidenceThreshold = JEV_DEFAULT_EVIDENCE_THRESHOLD,
  fallbackModel = JEV_DEFAULT_MODEL,
): JevCompletionReviewResult {
  if (!isRecord(rawResponse) || !isRecord(rawResponse.answers)) {
    return failedReview(fallbackModel, "invalid_response", rawResponse);
  }

  const model = asTrimmedString(rawResponse.model) ?? fallbackModel;
  const documentationEvidence = noulAnswer(
    rawResponse.answers.documentation_evidence,
  );
  const nextStepsEvidence = noulAnswer(
    rawResponse.answers.customer_next_steps_evidence,
  );
  const verificationEvidence = noulAnswer(
    rawResponse.answers.verification_evidence,
  );
  const documentationScore = scoreAnswer(rawResponse.answers.documentation_score);
  const nextStepsScore = scoreAnswer(
    rawResponse.answers.customer_next_steps_score,
  );
  const verificationScore = scoreAnswer(rawResponse.answers.verification_score);

  if (
    documentationEvidence === null ||
    nextStepsEvidence === null ||
    verificationEvidence === null ||
    !documentationScore ||
    !nextStepsScore ||
    !verificationScore
  ) {
    return failedReview(model, "invalid_response", rawResponse);
  }

  const dimensions: Record<JevReviewDimension, JevReviewDimensionResult> = {
    documentation: evaluateReviewDimension(
      documentationEvidence,
      documentationScore.score,
      documentationScore.confidence,
      evidenceThreshold,
    ),
    customerNextSteps: evaluateReviewDimension(
      nextStepsEvidence,
      nextStepsScore.score,
      nextStepsScore.confidence,
      evidenceThreshold,
    ),
    verification: evaluateReviewDimension(
      verificationEvidence,
      verificationScore.score,
      verificationScore.confidence,
      evidenceThreshold,
    ),
  };
  const values = Object.values(dimensions);
  const outcome: JevReviewOutcome = values.some(
    (dimension) => dimension.outcome === "missing_evidence",
  )
    ? "missing_evidence"
    : values.some((dimension) => dimension.outcome === "not_met")
      ? "not_met"
      : "met";

  return {
    status: "succeeded",
    model,
    rubricVersion: JEV_COMPLETION_REVIEW_RUBRIC_VERSION,
    outcome,
    dimensions,
    rawResponse,
    error: null,
  };
}

function buildCompletionReviewRequest(
  input: JevCompletionReviewInput,
  model: string,
): JevRequest {
  return {
    model,
    state: {
      ticket: {
        id: externalText(input.ticket.id, 160),
        title: externalText(input.ticket.title, 300),
        description: externalText(input.ticket.description, 12_000),
        issue_type: externalText(input.ticket.issueType, 120),
      },
      procedures: input.procedures.slice(0, 30).map((procedure) =>
        compact(procedure, 1_500),
      ),
      work_history: input.history.slice(-120).map((entry) => ({
        at: externalText(entry.at, 80),
        action: externalText(entry.action, 240),
        actor: externalText(entry.actor, 320),
        evidence: externalText(entry.evidence, 3_000),
      })),
    },
    questions: {
      documentation_evidence: {
        type: "noul",
        instructions:
          "The work history contains specific, auditable evidence of what the technician diagnosed, changed, and observed. Judge evidence presence only, not work quality.",
        criteria: {
          true: "Specific documentation evidence is present in the record.",
          false: "The record lacks enough documentation evidence to assess this dimension.",
        },
      },
      documentation_score: {
        type: "score",
        instructions:
          "Score the completeness and usefulness of the technician's documentation against the supplied ticket and procedures.",
        criteria: [
          "No useful diagnosis, action, or result is documented.",
          "Some actions are recorded, but important diagnosis or result details are unclear.",
          "Diagnosis, actions, and result are clear enough for another technician to follow.",
          "Documentation is concise, complete, auditable, and captures relevant context, actions, results, and follow-up.",
        ],
      },
      customer_next_steps_evidence: {
        type: "noul",
        instructions:
          "The work history contains evidence of a customer-facing resolution or clear next steps. Judge evidence presence only, not work quality.",
        criteria: {
          true: "A customer-facing resolution or next-step message is evidenced.",
          false: "The record lacks enough customer communication evidence to assess this dimension.",
        },
      },
      customer_next_steps_score: {
        type: "score",
        instructions:
          "Score how clear and actionable the evidenced customer resolution or next steps are.",
        criteria: [
          "No understandable resolution or next step is communicated.",
          "A next step exists but is vague, incomplete, or difficult to act on.",
          "The customer is given a clear resolution or practical next steps.",
          "The message is clear, appropriately scoped, actionable, and sets accurate expectations or escalation conditions.",
        ],
      },
      verification_evidence: {
        type: "noul",
        instructions:
          "The work history contains specific evidence that required verification steps from the supplied procedures were performed. Judge evidence presence only, not work quality.",
        criteria: {
          true: "Specific verification evidence is present in the record.",
          false: "The record lacks enough verification evidence to assess this dimension.",
        },
      },
      verification_score: {
        type: "score",
        instructions:
          "Score how well the evidenced verification covers the applicable procedure and confirms the reported issue was resolved or safely handed off.",
        criteria: [
          "Required verification was not performed or contradicts the claimed result.",
          "Verification is partial or leaves important procedure checks unconfirmed.",
          "Applicable verification steps are evidenced and support the result.",
          "Verification is thorough, directly tied to the issue and procedure, and records results or remaining risks.",
        ],
      },
    },
  };
}

export async function reviewCompletedWorkWithJev(
  input: JevCompletionReviewInput,
): Promise<JevCompletionReviewResult> {
  const model = modelFromEnvironment();
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();

  if (!apiKey) {
    return {
      ...failedReview(model, "missing_typesafe_api_key", null),
      status: "not_configured",
    };
  }
  if (typeof window !== "undefined") {
    return failedReview(model, "server_runtime_required", null);
  }

  try {
    const rawResponse = await postToJev(
      buildCompletionReviewRequest(input, model),
      apiKey,
      envNumber("JEV_TIMEOUT_MS", JEV_DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    );
    return parseJevCompletionReviewResponse(
      rawResponse,
      envNumber(
        "JEV_EVIDENCE_THRESHOLD",
        JEV_DEFAULT_EVIDENCE_THRESHOLD,
        0,
        1,
      ),
      model,
    );
  } catch (error) {
    return failedReview(
      model,
      error instanceof JevRequestError ? error.code : "request_failed",
      null,
    );
  }
}
