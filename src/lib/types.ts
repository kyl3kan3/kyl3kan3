export type Priority = "P1" | "P2" | "P3" | "P4";

export type TicketStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed";

export type JevAssessmentStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "retryable"
  | "failed"
  | "not_configured"
  | "superseded";

export type JevUrgency = "critical" | "high" | "normal" | "low";

export type JevIntakeAssessment = {
  status: JevAssessmentStatus;
  issueType: string | null;
  urgency: JevUrgency | null;
  suggestedTeamId: string | null;
  suggestedTeam: string | null;
  confidence: number | null;
  needsHumanTriage: boolean;
  model: string | null;
  assessedAt: string | null;
};

export type SoftwareRoutingDecision = {
  priority: Priority;
  assignedTeamId: string | null;
  assignedTeam: string | null;
  assignedUserId: string | null;
  assignedUser: string | null;
  responseDueAt: string | null;
  needsHumanTriage: boolean;
  ruleVersion: string;
};

export type ReviewCriterionOutcome =
  | "met"
  | "not_met"
  | "missing_evidence"
  | "not_applicable";

export type CompletionReviewCriterion = {
  id: "documentation" | "customer_next_steps" | "verification";
  label: string;
  outcome: ReviewCriterionOutcome;
  score: number | null;
  evidenceProbability: number | null;
  confidence: number | null;
};

export type JevCompletionReview = {
  status: JevAssessmentStatus;
  overallScore: number | null;
  evidenceCoverage: number | null;
  missingEvidenceCount: number;
  model: string | null;
  rubricVersion: string | null;
  reviewedAt: string | null;
  criteria: CompletionReviewCriterion[];
};

export type TicketQueueItem = {
  id: string;
  incidentId: string | null;
  ticketNumber: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  importanceScore: number;
  urgencyScore: number;
  assignedUserId: string | null;
  assignedTeamId: string | null;
  assignee: string;
  team: string;
  reporterEmail: string | null;
  customerName?: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdFrom: string;
  repairshoprUrl?: string | null;
  repairshoprStatus?: string | null;
  duplicateCount: number;
  comments: TicketComment[];
  intakeAssessment: JevIntakeAssessment | null;
  routingDecision: SoftwareRoutingDecision | null;
  completionReview: JevCompletionReview | null;
};

export type TicketComment = {
  id: string;
  ticketId: string;
  authorEmail: string | null;
  body: string;
  createdVia: "ui" | "email" | "sms" | "system";
  createdAt: string;
};

export type IncidentSnapshot = {
  id: string;
  title: string;
  status: "open" | "monitoring" | "resolved" | "closed";
  priority: Priority;
  importanceScore: number;
  urgencyScore: number;
  confidence: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  blastCount: number;
};

export type TeamLoad = {
  team: string;
  openTickets: number;
  urgentTickets: number;
  members: number;
};

export type OpsMetric = {
  key: "openTickets" | "p1Incidents" | "slaBreaches" | "avgAge";
  label: string;
  value: string;
  detail: string;
  tone: string;
};

export type TeamOption = {
  id: string;
  name: string;
  members: number;
  onCall: number;
};

export type UserRole = "reporter" | "agent" | "manager" | "admin";

export type UserOption = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  teamIds: string[];
  onCall: boolean;
};

export type DashboardData = {
  source: "database" | "demo";
  refreshedAt: string;
  ticketCounts: {
    active: number;
    archived: number;
    urgent: number;
    needsAttention: number;
    waiting: number;
    breached: number;
    resolved: number;
    closed: number;
    needsHumanTriage: number;
    completionReviewsPending: number;
  };
  ticketPage: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  integrations?: {
    jev?: {
      configured: boolean;
      model: string;
      triageRubricVersion: string;
      completionRubricVersion: string;
      procedureVersion: string;
      customProceduresConfigured: boolean;
    };
    repairshopr?: {
      configured: boolean;
      connected: boolean;
      lastSyncAt: string | null;
      lastStatus: "running" | "success" | "error" | "not_configured";
    };
  };
  ticketHighlights?: {
    urgent: TicketQueueItem[];
    breached: TicketQueueItem[];
    recent: TicketQueueItem[];
  };
  metrics: OpsMetric[];
  tickets: TicketQueueItem[];
  incidents: IncidentSnapshot[];
  teamLoad: TeamLoad[];
  teams: TeamOption[];
  users: UserOption[];
  dbError?: string;
};

export type ManagerQualityRow = {
  technicianId: string;
  technician: string;
  role: UserRole;
  issueType: string;
  model: string;
  rubricVersion: string;
  procedureVersion: string;
  handledTickets: number;
  medianResponseMinutes: number | null;
  averageResponseMinutes: number | null;
  reopenedTickets: number;
  reopenedRate: number | null;
  reviewedTickets: number;
  scoredCriteria: number;
  qualityScore: number | null;
  evidenceCoverage: number | null;
  missingEvidenceCount: number;
};

export type ManagerQualityData = {
  source: "database" | "demo";
  refreshedAt: string;
  windowDays: number;
  summary: {
    handledTickets: number;
    reviewedTickets: number;
    missingEvidenceCount: number;
    evidenceCoverage: number | null;
  };
  rows: ManagerQualityRow[];
  dbError?: string;
};
