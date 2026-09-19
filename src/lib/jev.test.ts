import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateReviewDimension,
  parseJevCompletionReviewResponse,
  parseJevTriageResponse,
  redactForJev,
  routingFromUrgency,
  type JevTeam,
} from "./jev";
import { completionProceduresForIssue } from "./jev-assessments";

const teams: JevTeam[] = [
  { id: "team-helpdesk", name: "Help Desk" },
  { id: "team-security", name: "Security" },
];

function choice(choice: string, confidence: number) {
  return {
    type: "choice",
    choice,
    probabilities: { [choice]: confidence },
    confidence,
  };
}

function score(value: number, confidence = 0.8) {
  return {
    type: "score",
    score: value,
    legend: {},
    probabilities: {},
    confidence,
  };
}

function noul(value: number) {
  return { type: "noul", noul: value };
}

test("parses a confident Jev ticket classification", () => {
  const result = parseJevTriageResponse(
    {
      model: "jev-1.0-test",
      answers: {
        issue_type: choice("security", 0.92),
        urgency: choice("critical", 0.88),
        suggested_team: choice("team_2", 0.9),
        human_triage: noul(0.08),
      },
    },
    teams,
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.issueType, "security");
  assert.equal(result.urgency, "critical");
  assert.equal(result.suggestedTeamId, "team-security");
  assert.equal(result.needsHumanTriage, false);
  assert.deepEqual(result.routing, {
    priority: "P1",
    importanceScore: 45,
    urgencyScore: 42,
    slaMinutes: 5,
  });
});

test("flags low-confidence or explicitly ambiguous triage for a human", () => {
  const result = parseJevTriageResponse(
    {
      answers: {
        issue_type: choice("software", 0.8),
        urgency: choice("normal", 0.31),
        suggested_team: choice("team_1", 0.7),
        human_triage: noul(0.2),
      },
    },
    teams,
    0.35,
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.needsHumanTriage, true);
  assert.equal(result.confidences?.minimum, 0.31);

  const manual = parseJevTriageResponse(
    {
      answers: {
        issue_type: choice("other", 0.7),
        urgency: choice("low", 0.7),
        suggested_team: choice("manual_triage", 0.8),
        human_triage: noul(0.75),
      },
    },
    teams,
  );
  assert.equal(manual.suggestedTeamId, null);
  assert.equal(manual.needsHumanTriage, true);
});

test("rejects invalid choices instead of trusting model output", () => {
  const invalidIssue = parseJevTriageResponse(
    {
      answers: {
        issue_type: choice("made_up_type", 0.99),
        urgency: choice("critical", 0.99),
        suggested_team: choice("team_1", 0.99),
        human_triage: noul(0.01),
      },
    },
    teams,
  );
  assert.equal(invalidIssue.status, "failed");
  assert.equal(invalidIssue.error, "invalid_response");
  assert.equal(invalidIssue.needsHumanTriage, true);

  const inventedTeam = parseJevTriageResponse(
    {
      answers: {
        issue_type: choice("network", 0.99),
        urgency: choice("high", 0.99),
        suggested_team: choice("team_99", 0.99),
        human_triage: noul(0.01),
      },
    },
    teams,
  );
  assert.equal(inventedTeam.status, "failed");

  const coercedConfidence = parseJevTriageResponse(
    {
      answers: {
        issue_type: { ...choice("network", 0.99), confidence: null },
        urgency: choice("high", 0.99),
        suggested_team: choice("team_1", 0.99),
        human_triage: noul(0.01),
      },
    },
    teams,
  );
  assert.equal(coercedConfidence.status, "failed");
});

test("routing rules, not Jev, map urgency to scores and SLA", () => {
  assert.deepEqual(routingFromUrgency("high"), {
    priority: "P2",
    importanceScore: 35,
    urgencyScore: 28,
    slaMinutes: 15,
  });
  assert.deepEqual(routingFromUrgency("low"), {
    priority: "P4",
    importanceScore: 10,
    urgencyScore: 8,
    slaMinutes: 240,
  });
});

test("redacts common secrets and personal identifiers before Jev", () => {
  const redacted = redactForJev(
    "Contact alex@example.com password=hunter2 Authorization: abc123 " +
      "Bearer eyJhbGciOiJIUzI1NiJ9.token and SSN 123-45-6789",
  );

  assert.equal(redacted.includes("alex@example.com"), false);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("eyJhbGciOiJIUzI1NiJ9.token"), false);
  assert.equal(redacted.includes("123-45-6789"), false);
  assert.match(redacted, /\[EMAIL_REDACTED\]/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("selects versioned company procedures by ticket issue type", (t) => {
  const previousJson = process.env.JEV_REVIEW_PROCEDURES_JSON;
  const previousVersion = process.env.JEV_REVIEW_PROCEDURE_VERSION;
  t.after(() => {
    if (previousJson === undefined) delete process.env.JEV_REVIEW_PROCEDURES_JSON;
    else process.env.JEV_REVIEW_PROCEDURES_JSON = previousJson;
    if (previousVersion === undefined) {
      delete process.env.JEV_REVIEW_PROCEDURE_VERSION;
    } else {
      process.env.JEV_REVIEW_PROCEDURE_VERSION = previousVersion;
    }
  });
  process.env.JEV_REVIEW_PROCEDURE_VERSION = "security-closeout-v3";
  process.env.JEV_REVIEW_PROCEDURES_JSON = JSON.stringify({
    default: ["Record the fix."],
    security: ["Confirm token revocation.", "Record the containment check."],
  });

  assert.deepEqual(completionProceduresForIssue("security"), {
    version: "security-closeout-v3",
    source: "configured",
    procedures: [
      "Confirm token revocation.",
      "Record the containment check.",
    ],
  });
});

test("missing evidence produces a null score, not a poor-performance score", () => {
  assert.deepEqual(evaluateReviewDimension(0.42, 0.4, 0.9, 0.65), {
    outcome: "missing_evidence",
    evidenceProbability: 0.42,
    score: null,
    confidence: 0.9,
  });
});

test("parses completion review and keeps missing evidence separate", () => {
  const result = parseJevCompletionReviewResponse({
    model: "jev-1.0-test",
    answers: {
      documentation_evidence: noul(0.93),
      documentation_score: score(2.6),
      customer_next_steps_evidence: noul(0.41),
      customer_next_steps_score: score(0.3),
      verification_evidence: noul(0.89),
      verification_score: score(1.2),
    },
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "missing_evidence");
  assert.equal(result.dimensions?.documentation.outcome, "met");
  assert.equal(result.dimensions?.customerNextSteps.outcome, "missing_evidence");
  assert.equal(result.dimensions?.customerNextSteps.score, null);
  assert.equal(result.dimensions?.verification.outcome, "not_met");
  assert.equal(result.dimensions?.verification.score, 1.2);
});

test("rejects malformed completion review responses", () => {
  const result = parseJevCompletionReviewResponse({
    answers: {
      documentation_evidence: noul(0.9),
      documentation_score: score(4.5),
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error, "invalid_response");
  assert.equal(result.outcome, null);
  assert.equal(result.dimensions, null);
});
