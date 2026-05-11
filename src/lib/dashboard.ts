import { getSql, hasDatabaseUrl } from "./db";
import { getDemoDashboardData } from "./demo-store";
import type {
  DashboardData,
  IncidentSnapshot,
  Priority,
  TicketComment,
  TicketStatus,
  UserOption,
} from "./types";

type MetricsRow = {
  open_tickets: number | string | null;
  p1_open: number | string | null;
  breached: number | string | null;
  avg_age_minutes: number | string | null;
};

type TicketRow = {
  id: string;
  incident_id: string | null;
  ticket_number: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  importance_score: number | string;
  urgency_score: number | string;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  assignee: string | null;
  team: string | null;
  reporter_email: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
  created_from: string;
  duplicate_count: number | string | null;
};

type CommentRow = {
  id: string;
  ticket_id: string;
  author_email: string | null;
  body: string;
  created_via: TicketComment["createdVia"];
  created_at: string;
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
  id: string;
  team: string | null;
  open_tickets: number | string | null;
  urgent_tickets: number | string | null;
  members: number | string | null;
  on_call: number | string | null;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserOption["role"];
  team_ids: string[] | null;
  on_call: boolean | null;
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
    return getDemoDashboardData();
  }

  try {
    const sql = getSql();

    const [
      metricsRows,
      ticketRows,
      commentRows,
      incidentRows,
      teamRows,
      userRows,
    ] = await Promise.all([
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
          t.incident_id,
          t.ticket_number::text as ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.importance_score,
          t.urgency_score,
          t.assigned_user_id,
          t.assigned_team_id,
          coalesce(u.full_name, u.email, 'Unassigned') as assignee,
          coalesce(tm.name, 'Unrouted') as team,
          t.reporter_email,
          t.sla_due_at::text,
          t.created_at::text,
          t.updated_at::text,
          t.created_from,
          coalesce(count(ial.alert_event_id), 0)::int as duplicate_count
        from tickets t
        left join users u on u.id = t.assigned_user_id
        left join teams tm on tm.id = t.assigned_team_id
        left join incident_alert_links ial on ial.incident_id = t.incident_id
        group by
          t.id,
          t.incident_id,
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.importance_score,
          t.urgency_score,
          t.assigned_user_id,
          t.assigned_team_id,
          u.full_name,
          u.email,
          tm.name,
          t.reporter_email,
          t.sla_due_at,
          t.created_at,
          t.updated_at,
          t.created_from
        order by
          case when t.status in ('resolved', 'closed') then 2 else 1 end,
          case t.priority when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end,
          t.updated_at desc
        limit 50
      `,
      sql`
        select
          id,
          ticket_id,
          author_email,
          body,
          created_via,
          created_at::text
        from ticket_comments
        order by created_at asc
        limit 500
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
        limit 12
      `,
      sql`
        select
          tm.id,
          tm.name as team,
          count(t.id) filter (where t.status not in ('resolved', 'closed'))::int as open_tickets,
          count(t.id) filter (
            where t.priority in ('P1', 'P2') and t.status not in ('resolved', 'closed')
          )::int as urgent_tickets,
          count(distinct team_members.user_id)::int as members,
          count(distinct team_members.user_id) filter (where team_members.is_on_call)::int as on_call
        from teams tm
        left join team_members on team_members.team_id = tm.id
        left join tickets t on t.assigned_team_id = tm.id
        group by tm.id, tm.name
        order by open_tickets desc, tm.name asc
      `,
      sql`
        select
          u.id,
          u.email,
          u.full_name,
          u.role,
          coalesce(array_remove(array_agg(tm.team_id::text), null), '{}') as team_ids,
          coalesce(bool_or(tm.is_on_call), false) as on_call
        from users u
        left join team_members tm on tm.user_id = u.id
        where u.is_active
        group by u.id, u.email, u.full_name, u.role
        order by u.full_name asc nulls last, u.email asc
      `,
    ]);

    const metrics = (metricsRows as MetricsRow[])[0] ?? {
      open_tickets: 0,
      p1_open: 0,
      breached: 0,
      avg_age_minutes: 0,
    };

    const commentsByTicket = new Map<string, TicketComment[]>();
    for (const comment of commentRows as CommentRow[]) {
      const comments = commentsByTicket.get(comment.ticket_id) ?? [];
      comments.push({
        id: comment.id,
        ticketId: comment.ticket_id,
        authorEmail: comment.author_email,
        body: comment.body,
        createdVia: comment.created_via,
        createdAt: comment.created_at,
      });
      commentsByTicket.set(comment.ticket_id, comments);
    }

    return {
      source: "database",
      refreshedAt: new Date().toISOString(),
      metrics: [
        {
          key: "openTickets",
          label: "Open tickets",
          value: String(toNumber(metrics.open_tickets)),
          detail: "Currently active queue",
          tone: "text-sky-600",
        },
        {
          key: "p1Incidents",
          label: "P1 incidents",
          value: String(toNumber(metrics.p1_open)),
          detail: "Immediate response",
          tone: "text-red-600",
        },
        {
          key: "slaBreaches",
          label: "SLA breaches",
          value: String(toNumber(metrics.breached)),
          detail: "Past due and unresolved",
          tone: "text-amber-600",
        },
        {
          key: "avgAge",
          label: "Avg age",
          value: `${toNumber(metrics.avg_age_minutes)}m`,
          detail: "Unresolved ticket age",
          tone: "text-emerald-600",
        },
      ],
      tickets: (ticketRows as TicketRow[]).map((ticket) => ({
        id: ticket.id,
        incidentId: ticket.incident_id,
        ticketNumber: ticket.ticket_number,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: toPriority(ticket.priority),
        importanceScore: toNumber(ticket.importance_score),
        urgencyScore: toNumber(ticket.urgency_score),
        assignedUserId: ticket.assigned_user_id,
        assignedTeamId: ticket.assigned_team_id,
        assignee: ticket.assignee ?? "Unassigned",
        team: ticket.team ?? "Unrouted",
        reporterEmail: ticket.reporter_email,
        slaDueAt: ticket.sla_due_at,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        createdFrom: ticket.created_from,
        duplicateCount: toNumber(ticket.duplicate_count),
        comments: commentsByTicket.get(ticket.id) ?? [],
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
      teams: (teamRows as TeamRow[]).map((team) => ({
        id: team.id,
        name: team.team ?? "Unrouted",
        members: toNumber(team.members),
        onCall: toNumber(team.on_call),
      })),
      users: (userRows as UserRow[]).map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        teamIds: user.team_ids ?? [],
        onCall: Boolean(user.on_call),
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return getDemoDashboardData(message);
  }
}
