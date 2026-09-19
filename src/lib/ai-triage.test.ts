import assert from "node:assert/strict";
import test from "node:test";
import { routeJevTriage, type AssignmentContext } from "./ai-triage";
import type { JevTriageResult } from "./jev";

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
      id: "team-security",
      name: "Security",
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
      id: "user-security",
      email: "sam@example.com",
      fullName: "Sam",
      teamIds: ["team-security"],
      isOnCall: true,
      openTickets: 1,
    },
  ],
};

const alert = {
  source: "resend",
  externalId: "email-1",
  senderEmail: "alerts@example.com",
  recipientEmail: "alerts@example.com",
  subject: "Suspicious account sign-in",
  bodyText: "A privileged account has an unexpected sign-in.",
  service: "identity",
  severity: "critical",
  createdFrom: "alert_email" as const,
};

function result(overrides: Partial<JevTriageResult> = {}): JevTriageResult {
  return {
    status: "succeeded",
    model: "jev-test",
    rubricVersion: "ticket-triage-v1",
    issueType: "security",
    urgency: "critical",
    suggestedTeamId: "team-security",
    confidences: {
      issueType: 0.9,
      urgency: 0.88,
      suggestedTeam: 0.92,
      minimum: 0.88,
      humanTriageProbability: 0.04,
    },
    needsHumanTriage: false,
    routing: {
      priority: "P1",
      importanceScore: 45,
      urgencyScore: 42,
      slaMinutes: 5,
    },
    rawResponse: {},
    error: null,
    ...overrides,
  };
}

test("Jev assesses while local rules assign priority, queue, and owner", () => {
  const decision = routeJevTriage(
    alert,
    { priority: "P3", importanceScore: 20, urgencyScore: 18 },
    context,
    result(),
  );

  assert.equal(decision.issueType, "security");
  assert.equal(decision.priority, "P1");
  assert.equal(decision.assignedTeamId, "team-security");
  assert.equal(decision.assignedUserId, "user-security");
  assert.equal(decision.needsHumanTriage, false);
});

test("low-confidence Jev results stay unassigned for a human", () => {
  const decision = routeJevTriage(
    alert,
    { priority: "P2", importanceScore: 35, urgencyScore: 28 },
    context,
    result({ needsHumanTriage: true }),
  );

  assert.equal(decision.assignedTeamId, "");
  assert.equal(decision.assignedUserId, "");
  assert.equal(decision.priority, "P2");
  assert.equal(decision.importanceScore, 35);
  assert.equal(decision.urgencyScore, 28);
  assert.equal(decision.needsHumanTriage, true);
});

test("Jev failure preserves safe heuristic priority and requires a human", () => {
  const decision = routeJevTriage(
    alert,
    { priority: "P2", importanceScore: 35, urgencyScore: 28 },
    context,
    result({
      status: "failed",
      issueType: null,
      urgency: null,
      suggestedTeamId: null,
      confidences: null,
      routing: null,
      error: "timeout",
    }),
  );

  assert.equal(decision.priority, "P2");
  assert.equal(decision.assignedTeamId, "");
  assert.equal(decision.fallbackReason, "timeout");
  assert.equal(decision.needsHumanTriage, true);
});
