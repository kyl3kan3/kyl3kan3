import type { LucideIcon } from "lucide-react";

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
  ticketNumber: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  importanceScore: number;
  urgencyScore: number;
  assignee: string;
  team: string;
  reporterEmail: string | null;
  slaDueAt: string | null;
  updatedAt: string;
  duplicateCount: number;
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
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
};

export type DashboardData = {
  source: "database" | "demo";
  refreshedAt: string;
  metrics: OpsMetric[];
  tickets: TicketQueueItem[];
  incidents: IncidentSnapshot[];
  teamLoad: TeamLoad[];
  dbError?: string;
};
