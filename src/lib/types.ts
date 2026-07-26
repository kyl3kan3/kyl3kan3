export type Priority = "P1" | "P2" | "P3" | "P4";

export type TicketStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed";

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
  };
  ticketPage: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  integrations?: {
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
