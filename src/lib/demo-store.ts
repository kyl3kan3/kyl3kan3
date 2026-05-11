import { randomUUID } from "node:crypto";
import { getMockDashboardData } from "./mock-data";
import type {
  DashboardData,
  IncidentSnapshot,
  Priority,
  TicketQueueItem,
  TicketStatus,
} from "./types";
import type {
  AddCommentInput,
  CreateTeamInput,
  CreateTicketInput,
  CreateUserInput,
  UpdateTicketInput,
} from "./operations";

const priorityRank: Record<Priority, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

type DemoGlobal = typeof globalThis & {
  __kyl3kan3DemoState__?: DashboardData;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureDemoState() {
  const store = globalThis as DemoGlobal;
  store.__kyl3kan3DemoState__ ??= getMockDashboardData();
  return store.__kyl3kan3DemoState__;
}

function isActive(status: TicketStatus) {
  return status !== "resolved" && status !== "closed";
}

function priorityScores(priority: Priority) {
  if (priority === "P1") return { importanceScore: 45, urgencyScore: 42 };
  if (priority === "P2") return { importanceScore: 35, urgencyScore: 28 };
  if (priority === "P3") return { importanceScore: 20, urgencyScore: 18 };
  return { importanceScore: 10, urgencyScore: 8 };
}

function slaMinutes(priority: Priority) {
  if (priority === "P1") return 5;
  if (priority === "P2") return 15;
  if (priority === "P3") return 60;
  return 240;
}

function incidentStatusForTicket(status: TicketStatus): IncidentSnapshot["status"] {
  if (status === "closed") return "closed";
  if (status === "resolved") return "resolved";
  return "open";
}

function nextTicketNumber(tickets: TicketQueueItem[]) {
  const highest = tickets.reduce((max, ticket) => {
    const value = Number(ticket.ticketNumber);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1038);

  return String(highest + 1);
}

function hydrateTicket(
  ticket: TicketQueueItem,
  data: DashboardData,
): TicketQueueItem {
  const user = data.users.find((item) => item.id === ticket.assignedUserId);
  const team = data.teams.find((item) => item.id === ticket.assignedTeamId);

  return {
    ...ticket,
    assignee: user?.fullName ?? user?.email ?? "Unassigned",
    team: team?.name ?? "Unrouted",
  };
}

function buildMetrics(tickets: TicketQueueItem[], nowMs: number) {
  const activeTickets = tickets.filter((ticket) => isActive(ticket.status));
  const p1Tickets = activeTickets.filter((ticket) => ticket.priority === "P1");
  const breached = activeTickets.filter((ticket) => {
    if (!ticket.slaDueAt) return false;
    return new Date(ticket.slaDueAt).getTime() < nowMs;
  });
  const waitingForOwner = activeTickets.filter(
    (ticket) => !ticket.assignedUserId,
  ).length;
  const avgAgeMinutes =
    activeTickets.length === 0
      ? 0
      : Math.round(
          activeTickets.reduce((total, ticket) => {
            return total + (nowMs - new Date(ticket.createdAt).getTime()) / 60_000;
          }, 0) / activeTickets.length,
        );

  return [
    {
      key: "openTickets" as const,
      label: "Open tickets",
      value: String(activeTickets.length),
      detail: `${waitingForOwner} waiting for owner`,
      tone: "text-sky-600",
    },
    {
      key: "p1Incidents" as const,
      label: "P1 incidents",
      value: String(p1Tickets.length),
      detail: "Immediate response",
      tone: "text-red-600",
    },
    {
      key: "slaBreaches" as const,
      label: "SLA breaches",
      value: String(breached.length),
      detail: "Past due and unresolved",
      tone: "text-amber-600",
    },
    {
      key: "avgAge" as const,
      label: "Avg age",
      value: `${Math.max(0, avgAgeMinutes)}m`,
      detail: "Unresolved ticket age",
      tone: "text-emerald-600",
    },
  ];
}

function deriveDashboard(data: DashboardData, dbError?: string): DashboardData {
  const nowMs = Date.now();
  const tickets = data.tickets
    .map((ticket) => hydrateTicket(ticket, data))
    .sort((left, right) => {
      const leftActive = isActive(left.status) ? 0 : 1;
      const rightActive = isActive(right.status) ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      if (priorityRank[left.priority] !== priorityRank[right.priority]) {
        return priorityRank[left.priority] - priorityRank[right.priority];
      }
      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    });

  return {
    ...clone(data),
    source: "demo",
    refreshedAt: new Date(nowMs).toISOString(),
    dbError,
    metrics: buildMetrics(tickets, nowMs),
    tickets,
    incidents: data.incidents
      .filter((incident) => incident.status !== "closed")
      .sort((left, right) => {
        if (priorityRank[left.priority] !== priorityRank[right.priority]) {
          return priorityRank[left.priority] - priorityRank[right.priority];
        }
        return (
          new Date(right.lastSeenAt).getTime() -
          new Date(left.lastSeenAt).getTime()
        );
      }),
    teamLoad: data.teams.map((team) => {
      const teamTickets = tickets.filter(
        (ticket) => ticket.assignedTeamId === team.id && isActive(ticket.status),
      );
      return {
        team: team.name,
        openTickets: teamTickets.length,
        urgentTickets: teamTickets.filter(
          (ticket) => ticket.priority === "P1" || ticket.priority === "P2",
        ).length,
        members: team.members,
      };
    }),
  };
}

function updateDemoTeamCounts(data: DashboardData) {
  for (const team of data.teams) {
    const teamUsers = data.users.filter((item) => item.teamIds.includes(team.id));
    team.members = teamUsers.length;
    team.onCall = teamUsers.filter((item) => item.onCall).length;
  }
}

export function getDemoDashboardData(dbError?: string) {
  return deriveDashboard(ensureDemoState(), dbError);
}

export async function createDemoTeam(input: CreateTeamInput) {
  const data = ensureDemoState();
  const existing = data.teams.find(
    (team) => team.name.toLowerCase() === input.name.toLowerCase(),
  );

  if (existing) return { id: existing.id };

  const team = {
    id: `demo-team-${randomUUID()}`,
    name: input.name,
    members: 0,
    onCall: 0,
  };
  data.teams.push(team);
  data.teamLoad.push({
    team: team.name,
    openTickets: 0,
    urgentTickets: 0,
    members: 0,
  });

  return { id: team.id };
}

export async function createDemoUser(input: CreateUserInput) {
  const data = ensureDemoState();
  const existing = data.users.find(
    (user) => user.email.toLowerCase() === input.email.toLowerCase(),
  );
  const teamIds = input.teamId ? [input.teamId] : [];

  if (existing) {
    existing.fullName = input.fullName ?? existing.fullName;
    existing.role = input.role;
    existing.teamIds = teamIds;
    existing.onCall = input.isOnCall;
    updateDemoTeamCounts(data);
    return { id: existing.id };
  }

  const user = {
    id: `demo-user-${randomUUID()}`,
    email: input.email,
    fullName: input.fullName ?? null,
    role: input.role,
    teamIds,
    onCall: input.isOnCall,
  };
  data.users.push(user);
  updateDemoTeamCounts(data);

  return { id: user.id };
}

export async function createDemoTicket(input: CreateTicketInput) {
  const data = ensureDemoState();
  const now = new Date();
  const priority = input.priority ?? "P3";
  const scores = priorityScores(priority);
  const assignedUser = input.assignedUserId
    ? data.users.find((user) => user.id === input.assignedUserId)
    : null;
  const assignedTeamId =
    input.assignedTeamId ?? assignedUser?.teamIds[0] ?? null;
  const incidentId = `demo-incident-${randomUUID()}`;
  const ticketId = `demo-ticket-${randomUUID()}`;
  const ticketNumber = nextTicketNumber(data.tickets);

  data.incidents.push({
    id: incidentId,
    title: input.title,
    status: "open",
    priority,
    importanceScore: scores.importanceScore,
    urgencyScore: scores.urgencyScore,
    confidence: 0.7,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    blastCount: 1,
  });

  data.tickets.unshift({
    id: ticketId,
    incidentId,
    ticketNumber,
    title: input.title,
    description: input.description ?? null,
    status: assignedTeamId || input.assignedUserId ? "assigned" : "new",
    priority,
    importanceScore: scores.importanceScore,
    urgencyScore: scores.urgencyScore,
    assignedUserId: input.assignedUserId ?? null,
    assignedTeamId,
    assignee: "Unassigned",
    team: "Unrouted",
    reporterEmail: input.reporterEmail ?? null,
    slaDueAt: new Date(now.getTime() + slaMinutes(priority) * 60_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdFrom: input.createdFrom ?? "manual",
    duplicateCount: 0,
    comments: input.comment
      ? [
          {
            id: `demo-comment-${randomUUID()}`,
            ticketId,
            authorEmail: input.reporterEmail || "operator@example.com",
            body: input.comment,
            createdVia: "ui",
            createdAt: now.toISOString(),
          },
        ]
      : [],
  });

  return { id: ticketId, ticket_number: ticketNumber };
}

export async function updateDemoTicket(
  ticketId: string,
  input: UpdateTicketInput,
) {
  const data = ensureDemoState();
  const ticket = data.tickets.find((item) => item.id === ticketId);

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (input.title !== undefined) {
    if (!input.title) throw new Error("Ticket title cannot be blank");
    ticket.title = input.title;
  }

  if (input.description !== undefined) {
    ticket.description = input.description;
  }

  if (input.status) {
    ticket.status = input.status;
    if (ticket.incidentId) {
      const incident = data.incidents.find((item) => item.id === ticket.incidentId);
      if (incident) {
        incident.status = incidentStatusForTicket(input.status);
        incident.lastSeenAt = new Date().toISOString();
      }
    }
  }

  if (input.priority) {
    const scores = priorityScores(input.priority);
    ticket.priority = input.priority;
    ticket.importanceScore = scores.importanceScore;
    ticket.urgencyScore = scores.urgencyScore;
    ticket.slaDueAt ??= new Date(
      Date.now() + slaMinutes(input.priority) * 60_000,
    ).toISOString();
  }

  if (input.assignedTeamId !== undefined) {
    ticket.assignedTeamId = input.assignedTeamId;
  }

  if (input.assignedUserId !== undefined) {
    ticket.assignedUserId = input.assignedUserId;
  }

  if (
    (input.assignedTeamId !== undefined || input.assignedUserId !== undefined) &&
    ticket.status === "new"
  ) {
    ticket.status = "assigned";
  }

  if (input.comment) {
    await addDemoTicketComment(ticketId, {
      body: input.comment,
      authorEmail: "operator@example.com",
    });
  }

  ticket.updatedAt = new Date().toISOString();
  return { id: ticketId };
}

export async function addDemoTicketComment(
  ticketId: string,
  input: AddCommentInput,
) {
  const data = ensureDemoState();
  const ticket = data.tickets.find((item) => item.id === ticketId);
  const body = typeof input.body === "string" ? input.body.trim() : "";

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (!body) {
    throw new Error("A comment body is required");
  }

  const comment = {
    id: `demo-comment-${randomUUID()}`,
    ticketId,
    authorEmail: input.authorEmail || "operator@example.com",
    body,
    createdVia: "ui" as const,
    createdAt: new Date().toISOString(),
  };

  ticket.comments.push(comment);
  ticket.updatedAt = comment.createdAt;
  return { id: comment.id };
}
