import { AlertTriangle, Clock3, Gauge, RadioTower } from "lucide-react";
import { getSql, hasDatabaseUrl } from "./db";
import { getMockDashboardData } from "./mock-data";
import type {
  DashboardData,
  IncidentSnapshot,
  Priority,
  TicketStatus,
} from "./types";

type MetricsRow = {
  open_tickets: number | string | null;
  p1_open: number | string | null;
  breached: number | string | null;
  avg_age_minutes: number | string | null;
};

type TicketRow = {
  id: string;
  ticket_number: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  importance_score: number | string;
  urgency_score: number | string;
  assignee: string | null;
  team: string | null;
  reporter_email: string | null;
  sla_due_at: string | null;
  updated_at: string;
  duplicate_count: number | string | null;
};

type IncidentRow = {
  id: string;
  title: string;
  status: IncidentSnapshot["status"];
  priority: Priority;
  importance_score: number | string;
  urgency_score: number | string;
  confidence: number | string | null;
  first_seen_at: string;
  last_seen_at: string;
  blast_count: number | string | null;
};

type TeamRow = {
  team: string | null;
  open_tickets: number | string | null;
  urgent_tickets: number | string | null;
  members: number | string | null;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function toPriority(value: string): Priority {
  if (value === "P1" || value === "P2" || value === "P3" || value === "P4") {
    return value;
  }

  return "P4";
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!hasDatabaseUrl()) {
    return getMockDashboardData();
  }

  try {
    const sql = getSql();

    const [metricsRows, ticketRows, incidentRows, teamRows] = await Promise.all([
      sql`
        select
          count(*) filter (where status not in ('resolved', 'closed'))::int as open_tickets,
          count(*) filter (where priority = 'P1' and status not in ('resolved', 'closed'))::int as p1_open,
          count(*) filter (
            where sla_due_at is not null
              and sla_due_at < now()
              and status not in ('resolved', 'closed')
          )::int as breached,
          coalesce(
            round(avg(extract(epoch from (now() - created_at)) / 60)
              filter (where status not in ('resolved', 'closed')))::int,
            0
          ) as avg_age_minutes
        from tickets
      `,
      sql`
        select
          t.id,
          t.ticket_number::text as ticket_number,
          t.title,
          t.status,
          t.priority,
          t.importance_score,
          t.urgency_score,
          coalesce(u.full_name, u.email, 'Unassigned') as assignee,
          coalesce(tm.name, 'Unrouted') as team,
          t.reporter_email,
          t.sla_due_at::text,
          t.updated_at::text,
          coalesce(count(ial.alert_event_id), 0)::int as duplicate_count
        from tickets t
        left join users u on u.id = t.assigned_user_id
        left join teams tm on tm.id = t.assigned_team_id
        left join incident_alert_links ial on ial.incident_id = t.incident_id
        where t.status not in ('resolved', 'closed')
        group by
          t.id,
          t.ticket_number,
          t.title,
          t.status,
          t.priority,
          t.importance_score,
          t.urgency_score,
          u.full_name,
          u.email,
          tm.name,
          t.reporter_email,
          t.sla_due_at,
          t.updated_at
        order by
          case t.priority when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end,
          t.updated_at desc
        limit 12
      `,
      sql`
        select
          id,
          title,
          status,
          priority,
          importance_score,
          urgency_score,
          confidence,
          first_seen_at::text,
          last_seen_at::text,
          coalesce(blast_count, 0)::int as blast_count
        from incidents
        where status <> 'closed'
        order by
          case priority when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end,
          last_seen_at desc
        limit 6
      `,
      sql`
        select
          tm.name as team,
          count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets,
          count(t.id) filter (
            where t.priority in ('P1', 'P2') and t.status not in ('resolved', 'closed')
          )::int as urgent_tickets,
          count(distinct team_members.user_id)::int as members
        from teams tm
        left join team_members on team_members.team_id = tm.id
        left join tickets t on t.assigned_team_id = tm.id
        group by tm.id, tm.name
        order by open_tickets desc, tm.name asc
      `,
    ]);

    const metrics = (metricsRows as MetricsRow[])[0] ?? {
      open_tickets: 0,
      p1_open: 0,
      breached: 0,
      avg_age_minutes: 0,
    };

    const data: DashboardData = {
      source: "database",
      refreshedAt: new Date().toISOString(),
      metrics: [
        {
          label: "Open tickets",
          value: String(toNumber(metrics.open_tickets)),
          detail: "Currently active queue",
          icon: RadioTower,
          tone: "text-sky-600",
        },
        {
          label: "P1 incidents",
          value: String(toNumber(metrics.p1_open)),
          detail: "Immediate response",
          icon: AlertTriangle,
          tone: "text-red-600",
        },
        {
          label: "SLA breaches",
          value: String(toNumber(metrics.breached)),
          detail: "Past due and unresolved",
          icon: Clock3,
          tone: "text-amber-600",
        },
        {
          label: "Avg age",
          value: `${toNumber(metrics.avg_age_minutes)}m`,
          detail: "Unresolved ticket age",
          icon: Gauge,
          tone: "text-emerald-600",
        },
      ],
      tickets: (ticketRows as TicketRow[]).map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        title: ticket.title,
        status: ticket.status,
        priority: toPriority(ticket.priority),
        importanceScore: toNumber(ticket.importance_score),
        urgencyScore: toNumber(ticket.urgency_score),
        assignee: ticket.assignee ?? "Unassigned",
        team: ticket.team ?? "Unrouted",
        reporterEmail: ticket.reporter_email,
        slaDueAt: ticket.sla_due_at,
        updatedAt: ticket.updated_at,
        duplicateCount: toNumber(ticket.duplicate_count),
      })),
      incidents: (incidentRows as IncidentRow[]).map((incident) => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        priority: toPriority(incident.priority),
        importanceScore: toNumber(incident.importance_score),
        urgencyScore: toNumber(incident.urgency_score),
        confidence:
          incident.confidence === null ? null : Number(incident.confidence),
        firstSeenAt: incident.first_seen_at,
        lastSeenAt: incident.last_seen_at,
        blastCount: toNumber(incident.blast_count),
      })),
      teamLoad: (teamRows as TeamRow[]).map((team) => ({
        team: team.team ?? "Unrouted",
        openTickets: toNumber(team.open_tickets),
        urgentTickets: toNumber(team.urgent_tickets),
        members: toNumber(team.members),
      })),
    };

    return data.tickets.length > 0 ? data : getMockDashboardData();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return getMockDashboardData(message);
  }
}
