import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock3,
  Filter,
  Gauge,
  Inbox,
  RadioTower,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getDashboardData } from "@/lib/dashboard";
import type { Priority, TicketQueueItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const priorityTone: Record<Priority, string> = {
  P1: "border-red-300 bg-red-50 text-red-700",
  P2: "border-amber-300 bg-amber-50 text-amber-700",
  P3: "border-sky-300 bg-sky-50 text-sky-700",
  P4: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

const statusTone: Record<string, string> = {
  new: "bg-violet-50 text-violet-700",
  triaged: "bg-sky-50 text-sky-700",
  assigned: "bg-indigo-50 text-indigo-700",
  in_progress: "bg-amber-50 text-amber-700",
  waiting: "bg-zinc-100 text-zinc-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-zinc-100 text-zinc-500",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function priorityIcon(priority: Priority) {
  if (priority === "P1") return <AlertTriangle className="h-4 w-4" />;
  if (priority === "P2") return <RadioTower className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}

function TicketRow({
  ticket,
  nowMs,
}: {
  ticket: TicketQueueItem;
  nowMs: number;
}) {
  const slaDate = ticket.slaDueAt ? new Date(ticket.slaDueAt) : null;
  const isBreached = slaDate ? slaDate.getTime() < nowMs : false;

  return (
    <article className="grid gap-4 border-b border-zinc-200 px-5 py-4 last:border-b-0 lg:grid-cols-[1fr_130px_130px_150px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[ticket.priority]}`}
          >
            {priorityIcon(ticket.priority)}
            {ticket.priority}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-medium ${statusTone[ticket.status] ?? "bg-zinc-100 text-zinc-700"}`}
          >
            {ticket.status.replace("_", " ")}
          </span>
          <span className="font-mono text-xs text-zinc-500">
            TK-{ticket.ticketNumber}
          </span>
        </div>
        <h2 className="truncate text-sm font-semibold text-zinc-950">
          {ticket.title}
        </h2>
        <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
          {ticket.reporterEmail ?? "system alert"} - {ticket.team}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Owner
        </p>
        <p className="mt-1 truncate text-sm text-zinc-800">{ticket.assignee}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Score
        </p>
        <p className="mt-1 text-sm text-zinc-800">
          {ticket.importanceScore} x {ticket.urgencyScore}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          SLA
        </p>
        <p
          className={`mt-1 text-sm font-medium ${isBreached ? "text-red-700" : "text-zinc-800"}`}
        >
          {ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "Not set"}
        </p>
      </div>
    </article>
  );
}

export default async function Home() {
  const dashboard = await getDashboardData();
  const primaryTicket = dashboard.tickets[0];
  const refreshedAtMs = new Date(dashboard.refreshedAt).getTime();

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Alert Triage
              </p>
              <h1 className="text-xl font-semibold tracking-tight">
                Operations queue
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
                dashboard.source === "database"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              {dashboard.source === "database" ? "Neon live" : "Demo data"}
            </span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm">
              <Filter className="h-4 w-4" />
              Filters
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white shadow-sm">
              <Search className="h-4 w-4" />
              Search
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-4 lg:px-8">
        {dashboard.metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">
                {metric.label}
              </p>
              <metric.icon className={`h-4 w-4 ${metric.tone}`} />
            </div>
            <p className="text-3xl font-semibold tracking-tight">
              {metric.value}
            </p>
            <p className="mt-2 text-sm text-zinc-500">{metric.detail}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-zinc-500" />
                <h2 className="text-base font-semibold">Triage inbox</h2>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                Refreshed {formatDateTime(dashboard.refreshedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {["All", "P1", "Unassigned", "Breached"].map((item) => (
                <button
                  key={item}
                  className="h-8 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {dashboard.tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} nowMs={refreshedAtMs} />
          ))}
        </div>

        <aside className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Active incident</h2>
              <Gauge className="h-5 w-5 text-zinc-500" />
            </div>
            {primaryTicket ? (
              <div>
                <span
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[primaryTicket.priority]}`}
                >
                  {priorityIcon(primaryTicket.priority)}
                  {primaryTicket.priority}
                </span>
                <h3 className="mt-3 text-lg font-semibold leading-6">
                  {primaryTicket.title}
                </h3>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-zinc-500">Assignee</dt>
                    <dd className="mt-1 font-medium">
                      {primaryTicket.assignee}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Duplicates</dt>
                    <dd className="mt-1 font-medium">
                      {primaryTicket.duplicateCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Updated</dt>
                    <dd className="mt-1 font-medium">
                      {formatDateTime(primaryTicket.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Reporter</dt>
                    <dd className="mt-1 truncate font-medium">
                      {primaryTicket.reporterEmail ?? "system"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white">
                    <CheckCircle2 className="h-4 w-4" />
                    Acknowledge
                  </button>
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700">
                    <Users className="h-4 w-4" />
                    Assign
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No active tickets.</p>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Team load</h2>
              <Users className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="space-y-4">
              {dashboard.teamLoad.map((team) => {
                const width = Math.min(100, Math.max(12, team.openTickets * 18));
                return (
                  <div key={team.team}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium">{team.team}</span>
                      <span className="text-zinc-500">
                        {team.openTickets} open
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100">
                      <div
                        className="h-2 rounded-full bg-zinc-950"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Incident stream</h2>
              <Clock3 className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="space-y-4">
              {dashboard.incidents.map((incident) => (
                <div key={incident.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-zinc-500">
                      {incident.priority}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatDateTime(incident.lastSeenAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-zinc-900">
                    {incident.title}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {incident.blastCount} linked alerts, {incident.status}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {dashboard.dbError ? (
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Neon query fallback: {dashboard.dbError}
          </div>
        </div>
      ) : null}
    </main>
  );
}
