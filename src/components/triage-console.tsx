"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  Gauge,
  Inbox,
  Layers3,
  MessageSquarePlus,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  DashboardData,
  OpsMetric,
  Priority,
  TicketQueueItem,
  TicketStatus,
  UserOption,
} from "@/lib/types";

const priorities: Priority[] = ["P1", "P2", "P3", "P4"];
const statuses: TicketStatus[] = [
  "new",
  "triaged",
  "assigned",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
];

const priorityTone: Record<Priority, string> = {
  P1: "border-red-500 bg-red-600 text-white",
  P2: "border-amber-300 bg-amber-300 text-zinc-950",
  P3: "border-sky-300 bg-sky-100 text-sky-800",
  P4: "border-emerald-300 bg-emerald-100 text-emerald-800",
};

const priorityRail: Record<Priority, string> = {
  P1: "bg-red-500",
  P2: "bg-amber-400",
  P3: "bg-sky-400",
  P4: "bg-emerald-400",
};

const statusTone: Record<TicketStatus, string> = {
  new: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  triaged: "bg-sky-50 text-sky-700 ring-sky-200",
  assigned: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200",
  waiting: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

const metricIcons: Record<OpsMetric["key"], typeof RadioTower> = {
  openTickets: RadioTower,
  p1Incidents: AlertTriangle,
  slaBreaches: Clock3,
  avgAge: Gauge,
};

const metricAccent: Record<OpsMetric["key"], string> = {
  openTickets: "border-sky-200 bg-sky-50 text-sky-700",
  p1Incidents: "border-red-200 bg-red-50 text-red-700",
  slaBreaches: "border-amber-200 bg-amber-50 text-amber-800",
  avgAge: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

type FilterStatus = "active" | "all" | TicketStatus;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function label(value: string) {
  return value.replace("_", " ");
}

function priorityIcon(priority: Priority) {
  if (priority === "P1") return <AlertTriangle className="h-4 w-4" />;
  if (priority === "P2") return <RadioTower className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}

function isActive(ticket: TicketQueueItem) {
  return ticket.status !== "resolved" && ticket.status !== "closed";
}

function ticketMatchesSearch(ticket: TicketQueueItem, query: string) {
  const haystack = [
    ticket.ticketNumber,
    ticket.title,
    ticket.description,
    ticket.assignee,
    ticket.team,
    ticket.reporterEmail,
    ticket.priority,
    ticket.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function usersForTeam(users: UserOption[], teamId: string | null) {
  if (!teamId) return users;
  return users.filter((user) => user.teamIds.includes(teamId));
}

function SelectField({
  labelText,
  value,
  onChange,
  children,
  disabled,
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-zinc-500">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium normal-case text-zinc-950 shadow-sm outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50"
      >
        {children}
      </select>
    </label>
  );
}

function TextField({
  labelText,
  value,
  onChange,
  placeholder,
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-zinc-500">
      {labelText}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-sm normal-case text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
      />
    </label>
  );
}

function MetricCard({ metric }: { metric: OpsMetric }) {
  const Icon = metricIcons[metric.key];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-500">{metric.label}</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">
            {metric.value}
          </p>
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg border ${metricAccent[metric.key]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-500">
        {metric.detail}
      </p>
    </div>
  );
}

function TicketListItem({
  ticket,
  selected,
  nowMs,
  onSelect,
}: {
  ticket: TicketQueueItem;
  selected: boolean;
  nowMs: number;
  onSelect: () => void;
}) {
  const slaDate = ticket.slaDueAt ? new Date(ticket.slaDueAt) : null;
  const isBreached = slaDate
    ? slaDate.getTime() < nowMs && isActive(ticket)
    : false;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full border-b border-zinc-200 bg-white px-4 py-4 text-left transition last:border-b-0 hover:bg-[#fbfaf6] ${
        selected ? "shadow-[inset_0_0_0_2px_#18181b]" : ""
      }`}
    >
      <span
        className={`absolute left-0 top-0 h-full w-1 ${priorityRail[ticket.priority]}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[ticket.priority]}`}
            >
              {priorityIcon(ticket.priority)}
              {ticket.priority}
            </span>
            <span
              className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold ring-1 ${statusTone[ticket.status]}`}
            >
              {label(ticket.status)}
            </span>
          </div>
          <h2 className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-950">
            {ticket.title}
          </h2>
        </div>
        <span className="shrink-0 rounded-md bg-zinc-950 px-2 py-1 font-mono text-xs text-white">
          TK-{ticket.ticketNumber}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="font-semibold text-zinc-400">Owner</p>
          <p className="mt-1 truncate text-zinc-700">{ticket.assignee}</p>
        </div>
        <div>
          <p className="font-semibold text-zinc-400">SLA</p>
          <p
            className={`mt-1 truncate font-semibold ${
              isBreached ? "text-red-700" : "text-zinc-700"
            }`}
          >
            {ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "Not set"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span className="truncate">{ticket.team}</span>
        <span className="shrink-0">
          {ticket.importanceScore} x {ticket.urgencyScore}
        </span>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-200 bg-white">
        <Search className="h-5 w-5 text-zinc-500" />
      </div>
      <p className="mt-4 text-sm font-semibold text-zinc-900">
        No tickets match
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Adjust filters or create one manually.
      </p>
    </div>
  );
}

export function TriageConsole({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(initialData.tickets[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [teamFilter, setTeamFilter] = useState("all");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    reporterEmail: "",
    priority: "P3" as Priority,
    assignedTeamId: "",
    assignedUserId: "",
  });

  const nowMs = new Date(data.refreshedAt).getTime();
  const activeTickets = data.tickets.filter(isActive).length;

  const filteredTickets = useMemo(() => {
    return data.tickets.filter((ticket) => {
      if (statusFilter === "active" && !isActive(ticket)) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "active" &&
        ticket.status !== statusFilter
      ) {
        return false;
      }
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) {
        return false;
      }
      if (teamFilter !== "all" && ticket.assignedTeamId !== teamFilter) {
        return false;
      }
      if (query && !ticketMatchesSearch(ticket, query)) return false;
      return true;
    });
  }, [data.tickets, priorityFilter, query, statusFilter, teamFilter]);

  const selectedTicket =
    filteredTickets.find((ticket) => ticket.id === selectedId) ??
    filteredTickets[0] ??
    null;
  const selectedIncident = selectedTicket?.incidentId
    ? data.incidents.find((incident) => incident.id === selectedTicket.incidentId)
    : null;

  async function refresh(nextSelectedId = selectedTicket?.id ?? selectedId) {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to refresh dashboard");
    const nextData = (await response.json()) as DashboardData;
    setData(nextData);
    if (nextData.tickets.some((ticket) => ticket.id === nextSelectedId)) {
      setSelectedId(nextSelectedId);
    } else {
      setSelectedId(nextData.tickets[0]?.id ?? "");
    }
  }

  function runMutation(action: () => Promise<string | void>) {
    setNotice(null);
    startTransition(async () => {
      try {
        const message = await action();
        if (message) setNotice(message);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  async function patchTicket(ticketId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      throw new Error(result.error ?? "Unable to update ticket");
    }

    await refresh(ticketId);
  }

  function createManualTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(async () => {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          assignedTeamId: draft.assignedTeamId || null,
          assignedUserId: draft.assignedUserId || null,
        }),
      });

      const result = (await response.json()) as {
        ticket?: { id: string };
        error?: string;
      };

      if (!response.ok || !result.ticket) {
        throw new Error(result.error ?? "Unable to create ticket");
      }

      setDraft({
        title: "",
        description: "",
        reporterEmail: "",
        priority: "P3",
        assignedTeamId: "",
        assignedUserId: "",
      });
      await refresh(result.ticket.id);
      return "Ticket created";
    });
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTicket) return;

    runMutation(async () => {
      const response = await fetch(`/api/tickets/${selectedTicket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment }),
      });

      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Unable to add comment");
      }

      setComment("");
      await refresh(selectedTicket.id);
      return "Comment added";
    });
  }

  const selectedTeamUsers = usersForTeam(
    data.users,
    selectedTicket?.assignedTeamId ?? null,
  );
  const draftTeamUsers = usersForTeam(data.users, draft.assignedTeamId || null);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#efeee8] text-zinc-950">
      <div className="grid min-h-screen lg:grid-cols-[76px_minmax(0,1fr)]">
        <aside className="hidden bg-[#15130f] text-white lg:flex lg:flex-col lg:items-center lg:justify-between lg:py-5">
          <div className="grid gap-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-zinc-950 shadow-sm">
              <Bell className="h-5 w-5" />
            </div>
            {[Inbox, Activity, Database, Users].map((Icon, index) => (
              <div
                key={index}
                className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                  index === 0
                    ? "bg-amber-300 text-zinc-950"
                    : "bg-white/10 text-zinc-300"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
            ))}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-xs font-semibold text-zinc-300">
            K3
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-zinc-200 bg-[#fbfaf6]/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1540px] flex-col gap-4 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white lg:hidden">
                  <Bell className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-500">
                    Alert Triage
                  </p>
                  <h1 className="truncate text-xl font-semibold text-zinc-950 sm:text-2xl">
                    Operations command center
                  </h1>
                </div>
              </div>
              <div className="grid w-[calc(100vw-2rem)] max-w-full grid-cols-1 gap-2 sm:flex sm:w-full sm:flex-wrap xl:w-auto">
                <span
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold ${
                    data.source === "database"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {data.source === "database" ? "Neon live" : "Demo data"}
                </span>
                <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-800">
                  <Layers3 className="h-4 w-4" />
                  Integrations pending
                </span>
                <button
                  type="button"
                  onClick={() =>
                    runMutation(() => refresh().then(() => "Refreshed"))
                  }
                  disabled={isPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>
          </header>

          <section className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 xl:px-8">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {data.metrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)_360px]">
              <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 bg-[#fbfaf6] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-950 text-white">
                        <Inbox className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold">
                          Triage queue
                        </h2>
                        <p className="text-sm text-zinc-500">
                          {activeTickets} active, {data.tickets.length} total
                        </p>
                      </div>
                    </div>
                    <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-600">
                      {filteredTickets.length} shown
                    </span>
                  </div>
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search tickets"
                      className="h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
                    />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <SelectField
                      labelText="Status"
                      value={statusFilter}
                      onChange={(value) => setStatusFilter(value as FilterStatus)}
                    >
                      <option value="active">Active</option>
                      <option value="all">All</option>
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      labelText="Priority"
                      value={priorityFilter}
                      onChange={(value) =>
                        setPriorityFilter(value as "all" | Priority)
                      }
                    >
                      <option value="all">All</option>
                      {priorities.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      labelText="Team"
                      value={teamFilter}
                      onChange={setTeamFilter}
                    >
                      <option value="all">All</option>
                      {data.teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </SelectField>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setPriorityFilter("all");
                          setStatusFilter("active");
                          setTeamFilter("all");
                        }}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 shadow-sm"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
                <div className="max-h-[calc(100vh-360px)] min-h-[360px] overflow-y-auto">
                  {filteredTickets.length > 0 ? (
                    filteredTickets.map((ticket) => (
                      <TicketListItem
                        key={ticket.id}
                        ticket={ticket}
                        selected={selectedTicket?.id === ticket.id}
                        nowMs={nowMs}
                        onSelect={() => setSelectedId(ticket.id)}
                      />
                    ))
                  ) : (
                    <EmptyState />
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                {selectedTicket ? (
                  <div>
                    <div className="border-b border-zinc-200 bg-zinc-950 p-5 text-white">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[selectedTicket.priority]}`}
                            >
                              {priorityIcon(selectedTicket.priority)}
                              {selectedTicket.priority}
                            </span>
                            <span className="rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-zinc-200">
                              TK-{selectedTicket.ticketNumber}
                            </span>
                          </div>
                          <h2 className="mt-4 max-w-3xl text-2xl font-semibold leading-8">
                            {selectedTicket.title}
                          </h2>
                          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
                            {selectedTicket.description || "No description yet."}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/10 p-3">
                          <p className="text-xs font-semibold text-zinc-400">
                            Last refresh
                          </p>
                          <p className="mt-1 text-sm font-semibold">
                            {formatDateTime(data.refreshedAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 border-b border-zinc-200 bg-[#fbfaf6] p-4 md:grid-cols-4">
                      {[
                        ["Status", label(selectedTicket.status)],
                        ["Owner", selectedTicket.assignee],
                        ["Team", selectedTicket.team],
                        [
                          "Reporter",
                          selectedTicket.reporterEmail ?? "system alert",
                        ],
                      ].map(([title, value]) => (
                        <div key={title} className="rounded-lg bg-white p-3">
                          <p className="text-xs font-semibold text-zinc-400">
                            {title}
                          </p>
                          <p className="mt-1 truncate text-sm font-semibold text-zinc-900">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="p-5">
                      <div className="grid gap-3 md:grid-cols-3">
                        <button
                          type="button"
                          disabled={isPending || data.source !== "database"}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "in_progress",
                                comment: "Acknowledged from the console.",
                              });
                              return "Acknowledged";
                            })
                          }
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={isPending || data.source !== "database"}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "resolved",
                                comment: "Resolved from the console.",
                              });
                              return "Resolved";
                            })
                          }
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Resolve
                        </button>
                        <button
                          type="button"
                          disabled={isPending || data.source !== "database"}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "triaged",
                                comment: "Reopened from the console.",
                              });
                              return "Reopened";
                            })
                          }
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 shadow-sm disabled:opacity-60"
                        >
                          <XCircle className="h-4 w-4" />
                          Reopen
                        </button>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <SelectField
                          labelText="Status"
                          value={selectedTicket.status}
                          disabled={isPending || data.source !== "database"}
                          onChange={(value) =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: value,
                                comment: `Status changed to ${label(value)}.`,
                              });
                              return "Status updated";
                            })
                          }
                        >
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          labelText="Priority"
                          value={selectedTicket.priority}
                          disabled={isPending || data.source !== "database"}
                          onChange={(value) =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                priority: value,
                                comment: `Priority changed to ${value}.`,
                              });
                              return "Priority updated";
                            })
                          }
                        >
                          {priorities.map((priority) => (
                            <option key={priority} value={priority}>
                              {priority}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          labelText="Team"
                          value={selectedTicket.assignedTeamId ?? ""}
                          disabled={isPending || data.source !== "database"}
                          onChange={(value) =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                assignedTeamId: value || null,
                                assignedUserId: null,
                                comment: "Team assignment updated.",
                              });
                              return "Team updated";
                            })
                          }
                        >
                          <option value="">Unrouted</option>
                          {data.teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          labelText="Owner"
                          value={selectedTicket.assignedUserId ?? ""}
                          disabled={isPending || data.source !== "database"}
                          onChange={(value) =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                assignedUserId: value || null,
                                comment: "Owner assignment updated.",
                              });
                              return "Owner updated";
                            })
                          }
                        >
                          <option value="">Unassigned</option>
                          {selectedTeamUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.fullName ?? user.email}
                            </option>
                          ))}
                        </SelectField>
                      </div>

                      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <form onSubmit={submitComment} className="space-y-3">
                          <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-zinc-500">
                            Comment
                            <textarea
                              value={comment}
                              onChange={(event) => setComment(event.target.value)}
                              rows={5}
                              placeholder="Add update"
                              disabled={isPending || data.source !== "database"}
                              className="w-full min-w-0 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm normal-case text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 disabled:bg-zinc-50"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={
                              !comment.trim() ||
                              isPending ||
                              data.source !== "database"
                            }
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 shadow-sm disabled:opacity-60"
                          >
                            <MessageSquarePlus className="h-4 w-4" />
                            Add comment
                          </button>
                        </form>

                        <div className="rounded-lg border border-zinc-200 bg-[#fbfaf6] p-4">
                          <p className="text-sm font-semibold text-zinc-950">
                            Incident shape
                          </p>
                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-500">Duplicates</span>
                              <span className="font-semibold">
                                {selectedTicket.duplicateCount}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-500">Score</span>
                              <span className="font-semibold">
                                {selectedTicket.importanceScore} x{" "}
                                {selectedTicket.urgencyScore}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-500">SLA</span>
                              <span className="font-semibold">
                                {selectedTicket.slaDueAt
                                  ? formatDateTime(selectedTicket.slaDueAt)
                                  : "Not set"}
                              </span>
                            </div>
                            {selectedIncident ? (
                              <div className="border-t border-zinc-200 pt-3 text-sm text-zinc-600">
                                {selectedIncident.blastCount} linked alerts,
                                confidence {selectedIncident.confidence ?? "n/a"}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 border-t border-zinc-200 pt-5">
                        <div className="mb-4 flex items-center justify-between">
                          <h3 className="text-base font-semibold">Timeline</h3>
                          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
                            {selectedTicket.comments.length} comments
                          </span>
                        </div>
                        <div className="space-y-4">
                          {selectedTicket.comments.length > 0 ? (
                            selectedTicket.comments.map((item) => (
                              <div
                                key={item.id}
                                className="grid gap-3 border-l-2 border-zinc-300 pl-4"
                              >
                                <p className="text-sm leading-6 text-zinc-900">
                                  {item.body}
                                </p>
                                <p className="text-xs text-zinc-500">
                                  {item.authorEmail ?? "system"} -{" "}
                                  {formatDateTime(item.createdAt)}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-zinc-500">
                              No comments yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-[520px] place-items-center p-8 text-center">
                    <div>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-950 text-white">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <p className="mt-4 text-base font-semibold text-zinc-950">
                        Select or create a ticket
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <aside className="space-y-5">
                <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Manual intake</h2>
                      <p className="text-sm text-zinc-500">Create a live ticket</p>
                    </div>
                    <Plus className="h-5 w-5 text-zinc-500" />
                  </div>
                  <form onSubmit={createManualTicket} className="space-y-3">
                    <TextField
                      labelText="Title"
                      value={draft.title}
                      onChange={(value) =>
                        setDraft((next) => ({ ...next, title: value }))
                      }
                      placeholder="Short incident title"
                    />
                    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-zinc-500">
                      Description
                      <textarea
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((next) => ({
                            ...next,
                            description: event.target.value,
                          }))
                        }
                        rows={4}
                        placeholder="What happened?"
                        className="w-full min-w-0 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm normal-case text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
                      />
                    </label>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                      <SelectField
                        labelText="Priority"
                        value={draft.priority}
                        onChange={(value) =>
                          setDraft((next) => ({
                            ...next,
                            priority: value as Priority,
                          }))
                        }
                      >
                        {priorities.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </SelectField>
                      <TextField
                        labelText="Reporter"
                        value={draft.reporterEmail}
                        onChange={(value) =>
                          setDraft((next) => ({ ...next, reporterEmail: value }))
                        }
                        placeholder="email"
                      />
                      <SelectField
                        labelText="Team"
                        value={draft.assignedTeamId}
                        onChange={(value) =>
                          setDraft((next) => ({
                            ...next,
                            assignedTeamId: value,
                            assignedUserId: "",
                          }))
                        }
                      >
                        <option value="">Unrouted</option>
                        {data.teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        labelText="Owner"
                        value={draft.assignedUserId}
                        onChange={(value) =>
                          setDraft((next) => ({ ...next, assignedUserId: value }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {draftTeamUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.fullName ?? user.email}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <button
                      type="submit"
                      disabled={
                        !draft.title.trim() ||
                        isPending ||
                        data.source !== "database"
                      }
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      Create ticket
                    </button>
                  </form>
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold">Team load</h2>
                    <Users className="h-5 w-5 text-zinc-500" />
                  </div>
                  <div className="space-y-4">
                    {data.teamLoad.map((team) => {
                      const width = Math.min(
                        100,
                        Math.max(12, team.openTickets * 18),
                      );
                      return (
                        <div key={team.team}>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-semibold">{team.team}</span>
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
                </section>

                <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-300 text-zinc-950">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold">
                        Final setup queue
                      </h2>
                      <p className="text-sm text-amber-800">
                        Provider webhooks and API keys
                      </p>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </div>
      </div>

      {notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 shadow-lg">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
