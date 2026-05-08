"use client";

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock3,
  Gauge,
  Inbox,
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
import type { FormEvent } from "react";
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
  P1: "border-red-300 bg-red-50 text-red-700",
  P2: "border-amber-300 bg-amber-50 text-amber-700",
  P3: "border-sky-300 bg-sky-50 text-sky-700",
  P4: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

const statusTone: Record<TicketStatus, string> = {
  new: "bg-violet-50 text-violet-700",
  triaged: "bg-sky-50 text-sky-700",
  assigned: "bg-indigo-50 text-indigo-700",
  in_progress: "bg-amber-50 text-amber-700",
  waiting: "bg-zinc-100 text-zinc-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-zinc-100 text-zinc-500",
};

const metricIcons: Record<OpsMetric["key"], typeof RadioTower> = {
  openTickets: RadioTower,
  p1Incidents: AlertTriangle,
  slaBreaches: Clock3,
  avgAge: Gauge,
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
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium normal-case tracking-normal text-zinc-900 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50"
      >
        {children}
      </select>
    </label>
  );
}

function MetricCard({ metric }: { metric: OpsMetric }) {
  const Icon = metricIcons[metric.key];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">{metric.label}</p>
        <Icon className={`h-4 w-4 ${metric.tone}`} />
      </div>
      <p className="text-3xl font-semibold tracking-tight">{metric.value}</p>
      <p className="mt-2 text-sm text-zinc-500">{metric.detail}</p>
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
  const isBreached = slaDate ? slaDate.getTime() < nowMs && isActive(ticket) : false;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full gap-4 border-b border-zinc-200 px-5 py-4 text-left transition last:border-b-0 hover:bg-zinc-50 lg:grid-cols-[1fr_120px_100px_140px] ${
        selected ? "bg-zinc-50 shadow-[inset_3px_0_0_#18181b]" : "bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[ticket.priority]}`}
          >
            {priorityIcon(ticket.priority)}
            {ticket.priority}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-medium ${statusTone[ticket.status]}`}
          >
            {label(ticket.status)}
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
    </button>
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

  const filteredTickets = useMemo(() => {
    return data.tickets.filter((ticket) => {
      if (statusFilter === "active" && !isActive(ticket)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && ticket.status !== statusFilter) {
        return false;
      }
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) return false;
      if (teamFilter !== "all" && ticket.assignedTeamId !== teamFilter) return false;
      if (query && !ticketMatchesSearch(ticket, query)) return false;
      return true;
    });
  }, [data.tickets, priorityFilter, query, statusFilter, teamFilter]);

  const selectedTicket =
    filteredTickets.find((ticket) => ticket.id === selectedId) ??
    filteredTickets[0] ??
    null;

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
                data.source === "database"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              {data.source === "database" ? "Neon live" : "Demo data"}
            </span>
            <button
              type="button"
              onClick={() => runMutation(() => refresh().then(() => "Refreshed"))}
              disabled={isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-4 lg:px-8">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} />
        ))}
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-8">
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Inbox className="h-5 w-5 text-zinc-500" />
                  <h2 className="text-base font-semibold">Triage inbox</h2>
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  Refreshed {formatDateTime(data.refreshedAt)}
                </p>
              </div>
              <div className="relative w-full lg:w-72">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tickets"
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-zinc-400"
                />
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <SelectField labelText="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as FilterStatus)}>
                <option value="active">Active</option>
                <option value="all">All</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </SelectField>
              <SelectField labelText="Priority" value={priorityFilter} onChange={(value) => setPriorityFilter(value as "all" | Priority)}>
                <option value="all">All</option>
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </SelectField>
              <SelectField labelText="Team" value={teamFilter} onChange={setTeamFilter}>
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
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>
          </div>

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
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-zinc-900">No tickets match.</p>
              <p className="mt-1 text-sm text-zinc-500">Adjust filters or create one manually.</p>
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Ticket controls</h2>
              <Sparkles className="h-5 w-5 text-zinc-500" />
            </div>
            {selectedTicket ? (
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${priorityTone[selectedTicket.priority]}`}
                    >
                      {priorityIcon(selectedTicket.priority)}
                      {selectedTicket.priority}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      TK-{selectedTicket.ticketNumber}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold leading-6">
                    {selectedTicket.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {selectedTicket.description || "No description yet."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-3 gap-2">
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
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Ack
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
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 disabled:opacity-60"
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
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" />
                    Reopen
                  </button>
                </div>

                <form onSubmit={submitComment} className="space-y-2">
                  <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Comment
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      placeholder="Add update"
                      disabled={isPending || data.source !== "database"}
                      className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-zinc-900 outline-none transition focus:border-zinc-400 disabled:bg-zinc-50"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!comment.trim() || isPending || data.source !== "database"}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 disabled:opacity-60"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    Add comment
                  </button>
                </form>

                <div className="border-t border-zinc-200 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">Timeline</p>
                    <span className="text-xs text-zinc-500">
                      {selectedTicket.comments.length} comments
                    </span>
                  </div>
                  <div className="space-y-3">
                    {selectedTicket.comments.length > 0 ? (
                      selectedTicket.comments.map((item) => (
                        <div key={item.id} className="border-l-2 border-zinc-200 pl-3">
                          <p className="text-sm text-zinc-900">{item.body}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.authorEmail ?? "system"} - {formatDateTime(item.createdAt)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No comments yet.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Select or create a ticket.</p>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Manual intake</h2>
              <Plus className="h-5 w-5 text-zinc-500" />
            </div>
            <form onSubmit={createManualTicket} className="space-y-3">
              <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Title
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((next) => ({ ...next, title: event.target.value }))}
                  placeholder="Short incident title"
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm normal-case tracking-normal text-zinc-900 outline-none transition focus:border-zinc-400"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Description
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((next) => ({ ...next, description: event.target.value }))}
                  rows={3}
                  placeholder="What happened?"
                  className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-zinc-900 outline-none transition focus:border-zinc-400"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <SelectField labelText="Priority" value={draft.priority} onChange={(value) => setDraft((next) => ({ ...next, priority: value as Priority }))}>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </SelectField>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Reporter
                  <input
                    value={draft.reporterEmail}
                    onChange={(event) => setDraft((next) => ({ ...next, reporterEmail: event.target.value }))}
                    placeholder="email"
                    className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm normal-case tracking-normal text-zinc-900 outline-none transition focus:border-zinc-400"
                  />
                </label>
                <SelectField labelText="Team" value={draft.assignedTeamId} onChange={(value) => setDraft((next) => ({ ...next, assignedTeamId: value, assignedUserId: "" }))}>
                  <option value="">Unrouted</option>
                  {data.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField labelText="Owner" value={draft.assignedUserId} onChange={(value) => setDraft((next) => ({ ...next, assignedUserId: value }))}>
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
                disabled={!draft.title.trim() || isPending || data.source !== "database"}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Create ticket
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Team load</h2>
              <Users className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="space-y-4">
              {data.teamLoad.map((team) => {
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
        </aside>
      </section>

      {notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 shadow-lg">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
