import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicDecision,
  triageIncomingAlert,
  validateAiDecision,
  type AssignmentContext,
  type HeuristicScore,
  type NormalizedAlertForTriage,
} from "./ai-triage";

const context: AssignmentContext = {
  teams: [
    {
      id: "team-platform",
      name: "Platform",
      openTickets: 4,
      urgentTickets: 1,
      members: 1,
      onCall: 1,
    },
    {
      id: "team-database",
      name: "Database",
      openTickets: 1,
      urgentTickets: 0,
      members: 1,
      onCall: 1,
    },
  ],
  users: [
    {
      id: "user-platform",
      email: "maya@example.com",
      fullName: "Maya",
      teamIds: ["team-platform"],
      isOnCall: true,
      openTickets: 4,
    },
    {
      id: "user-database",
      email: "riley@example.com",
      fullName: "Riley",
      teamIds: ["team-database"],
      isOnCall: true,
      openTickets: 1,
    },
  ],
};

const alert: NormalizedAlertForTriage = {
  source: "resend",
  externalId: "email-1",
  senderEmail: "alerts@example.com",
  recipientEmail: "alerts@decent4.com",
  subject: "Database timeout spike",
  bodyText: "Postgres query timeout spike is affecting checkout.",
  service: "postgres",
  severity: "critical",
  createdFrom: "alert_email",
};

const heuristicScore: HeuristicScore = {
  priority: "P2",
  importanceScore: 35,
  urgencyScore: 28,
};

test("accepts valid AI assignment output", () => {
  const decision = validateAiDecision(
    {
      title: "Database timeout spike",
      summary: "Postgres query timeouts are affecting checkout.",
      createdFrom: "alert_email",
      service: "postgres",
      severity: "critical",
      priority: "P1",
      importanceScore: 50,
      urgencyScore: 45,
      assignedTeamId: "team-database",
      assignedUserId: "user-database",
      confidence: 0.91,
      reasoning: "Database terms and low current team load.",
      dedupHint: "postgres timeout checkout",
    },
    alert,
    heuristicScore,
    context,
    "test-model",
  );

  assert.equal(decision?.usedAi, true);
  assert.equal(decision?.assignedTeamId, "team-database");
  assert.equal(decision?.assignedUserId, "user-database");
  assert.equal(decision?.priority, "P1");
});

test("rejects invalid assignment IDs", () => {
  const decision = validateAiDecision(
    {
      title: "Database timeout spike",
      summary: "Postgres query timeouts are affecting checkout.",
      createdFrom: "alert_email",
      service: "postgres",
      severity: "critical",
      priority: "P1",
      importanceScore: 50,
      urgencyScore: 45,
      assignedTeamId: "missing-team",
      assignedUserId: "missing-user",
      confidence: 0.91,
      reasoning: "Bad IDs.",
      dedupHint: "postgres timeout checkout",
    },
    alert,
    heuristicScore,
    context,
    "test-model",
  );

  assert.equal(decision, null);
});

test("keeps low-confidence valid AI assignment", () => {
  const decision = validateAiDecision(
    {
      title: "Client billing question",
      summary: "A customer needs help with a billing request.",
      createdFrom: "client_email",
      service: "billing",
      severity: "normal",
      priority: "P3",
      importanceScore: 20,
      urgencyScore: 20,
      assignedTeamId: "team-platform",
      assignedUserId: "user-platform",
      confidence: 0.22,
      reasoning: "Valid but low confidence.",
      dedupHint: "billing customer request",
    },
    { ...alert, createdFrom: "client_email" },
    heuristicScore,
    context,
    "test-model",
  );

  assert.equal(decision?.createdFrom, "client_email");
  assert.equal(decision?.assignedTeamId, "team-platform");
  assert.equal(decision?.confidence, 0.22);
});

test("deterministic fallback always assigns when context has teams and users", () => {
  const decision = deterministicDecision(
    alert,
    heuristicScore,
    context,
    "test-model",
    "missing_openai_api_key",
  );

  assert.equal(decision.usedAi, false);
  assert.equal(decision.fallbackReason, "missing_openai_api_key");
  assert.equal(decision.assignedTeamId, "team-database");
  assert.equal(decision.assignedUserId, "user-database");
});

test("missing OpenAI key route returns deterministic assignment", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const decision = await triageIncomingAlert({
    alert,
    rawPayload: { type: "email.received", data: { subject: alert.subject } },
    heuristicScore,
    context,
  });
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;

  assert.equal(decision.usedAi, false);
  assert.equal(decision.assignedTeamId, "team-database");
  assert.equal(decision.assignedUserId, "user-database");
});
