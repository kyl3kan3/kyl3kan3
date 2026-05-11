"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  MessageSquarePlus,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { HelpdeskShell } from "@/components/helpdesk-shell";
import type {
  DashboardData,
  IncidentSnapshot,
  Priority,
  TicketQueueItem,
  TicketStatus,
  UserOption,
} from "@/lib/types";

type FilterStatus = "active" | "all" | TicketStatus;

type DraftTicket = {
  title: string;
  description: string;
  reporterEmail: string;
  priority: Priority;
  assignedTeamId: string;
  assignedUserId: string;
};

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

const emptyDraft: DraftTicket = {
  title: "",
  description: "",
  reporterEmail: "",
  priority: "P3",
  assignedTeamId: "",
  assignedUserId: "",
};

const priorityClass: Record<Priority, string> = {
  P1: "priority-p1",
  P2: "priority-p2",
  P3: "priority-p3",
  P4: "priority-p4",
};

const statusTone: Record<TicketStatus, string> = {
  new: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  triaged: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  assigned: "bg-white text-slate-700 ring-1 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
  waiting: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  closed: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

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

function friendlyStatus(status: TicketStatus) {
  if (status === "waiting") return "Waiting";
  if (status === "resolved" || status === "closed") return "Done";
  if (status === "in_progress") return "Being worked";
  return "Needs attention";
}

function friendlyPriority(priority: Priority) {
  if (priority === "P1") return "High";
  if (priority === "P2") return "Medium";
  if (priority === "P3") return "Normal";
  return "Low";
}

function isActive(ticket: TicketQueueItem) {
  return ticket.status !== "resolved" && ticket.status !== "closed";
}

function isBreachedTicket(ticket: TicketQueueItem, nowMs: number) {
  if (!ticket.slaDueAt || !isActive(ticket)) return false;
  return new Date(ticket.slaDueAt).getTime() < nowMs;
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
    <label className="grid min-w-0 gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#737064]">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field h-11 w-full rounded-2xl px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
  inputRef,
  type = "text",
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  type?: "email" | "password" | "text" | "url";
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#737064]">
      {labelText}
      <input
        type={type}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field h-11 w-full rounded-2xl px-3 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-[#d7ecdf] bg-white px-4 py-3 text-sm font-bold text-[#1f2937] shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500 ring-pulse" />
        {message}
      </div>
    </div>
  );
}

function HealthButton({
  isLive,
  isPending,
  onClick,
}: {
  isLive: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60"
    >
      <ShieldCheck className="h-4 w-4" />
      {isLive ? "Live data" : "Demo data"}
    </button>
  );
}

function useDashboardState(initialData: DashboardData) {
  const [data, setData] = useState(initialData);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to refresh dashboard");
    const nextData = (await response.json()) as DashboardData;
    setData(nextData);
    return nextData;
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

  async function checkHealth() {
    const response = await fetch("/api/health", { cache: "no-store" });
    const result = (await response.json()) as {
      ok?: boolean;
      database?: string;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Health check failed");
    }
    return `Health ok: database ${result.database ?? "unknown"}`;
  }

  async function createTicket(draft: DraftTicket) {
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description,
        reporterEmail: draft.reporterEmail,
        priority: draft.priority,
        assignedTeamId: draft.assignedTeamId || null,
        assignedUserId: draft.assignedUserId || null,
      }),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      ticket?: { id: string; ticket_number?: string };
    };
    if (!response.ok || !result.ok || !result.ticket) {
      throw new Error(result.error ?? "Unable to create ticket");
    }
    await refresh();
    window.location.href = `/tickets/${result.ticket.id}`;
    return result.ticket.ticket_number
      ? `Created TK-${result.ticket.ticket_number}`
      : "Request created";
  }

  async function patchTicket(ticketId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Unable to update ticket");
    }
    await refresh();
  }

  async function addComment(ticketId: string, body: string) {
    const response = await fetch(`/api/tickets/${ticketId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, authorEmail: "operator@example.com" }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Unable to add note");
    }
    await refresh();
  }

  return {
    data,
    notice,
    isPending,
    runMutation,
    refresh,
    checkHealth,
    createTicket,
    patchTicket,
    addComment,
  };
}

function TicketTask({ ticket, nowMs }: { ticket: TicketQueueItem; nowMs: number }) {
  const isBreached = isBreachedTicket(ticket, nowMs);

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="group block rounded-2xl border border-[#e7dfd2] bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-[#cfc4b4] hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold ${priorityClass[ticket.priority]}`}
            >
              {friendlyPriority(ticket.priority)}
            </span>
            <span
              className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold ${statusTone[ticket.status]}`}
            >
              {friendlyStatus(ticket.status)}
            </span>
            {isBreached ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-red-50 px-2.5 text-[11px] font-bold text-red-700 ring-1 ring-red-100">
                <Clock3 className="h-3 w-3" />
                Due now
              </span>
            ) : null}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-bold leading-6 text-[#1f2937]">
            {ticket.title}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-[#f7f5f0] px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide text-[#737064] ring-1 ring-[#e7dfd2]">
          TK-{ticket.ticketNumber}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#737064]">
        <span className="truncate">Customer: {ticket.reporterEmail ?? "System alert"}</span>
        <span className="truncate">Owner: {ticket.assignee}</span>
        <span className={isBreached ? "font-bold text-red-700" : "font-semibold"}>
          {ticket.slaDueAt ? `Due ${formatDateTime(ticket.slaDueAt)}` : "No due time"}
        </span>
      </div>
    </Link>
  );
}

function WorkBucket({
  title,
  helper,
  tickets,
  nowMs,
  emptyMessage,
}: {
  title: string;
  helper: string;
  tickets: TicketQueueItem[];
  nowMs: number;
  emptyMessage: string;
}) {
  const visibleTickets = tickets.slice(0, 6);
  return (
    <section className="rounded-[28px] border border-[#e7dfd2] bg-white/80 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold tracking-tight text-[#1f2937]">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-[#737064]">{helper}</p>
        </div>
        <span className="rounded-full bg-[#f7f5f0] px-3 py-1 text-[12px] font-bold tabular-nums text-[#24324a] ring-1 ring-[#e7dfd2]">
          {tickets.length}
        </span>
      </div>
      {visibleTickets.length > 0 ? (
        <div className="grid gap-3">
          {visibleTickets.map((ticket) => (
            <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#d8cfc1] bg-[#fbfaf7] px-4 py-8 text-center text-sm font-medium text-[#737064]">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function NewTicketModal({
  isOpen,
  onClose,
  data,
  onSubmit,
  isPending,
  canMutate,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: DashboardData;
  onSubmit: (draft: DraftTicket) => void;
  isPending: boolean;
  canMutate: boolean;
}) {
  const [draft, setDraft] = useState<DraftTicket>(emptyDraft);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const draftTeamUsers = usersForTeam(data.users, draft.assignedTeamId || null);

  useEffect(() => {
    if (!isOpen) return;
    const focusTimeout = window.setTimeout(() => titleRef.current?.focus(), 50);
    return () => window.clearTimeout(focusTimeout);
  }, [isOpen]);

  if (!isOpen) return null;

  function resetAndClose() {
    setDraft(emptyDraft);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(draft);
    setDraft(emptyDraft);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-request-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
      onClick={resetAndClose}
    >
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[28px] border border-[#e7dfd2] bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="new-request-title" className="text-lg font-bold text-[#1f2937]">
              New request
            </h2>
            <p className="text-sm text-[#737064]">Add a task for the team.</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <TextField
            labelText="Title"
            inputRef={titleRef}
            value={draft.title}
            onChange={(value) => setDraft((next) => ({ ...next, title: value }))}
            placeholder="What needs help?"
          />
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#737064]">
            Notes
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((next) => ({ ...next, description: event.target.value }))
              }
              rows={4}
              placeholder="Add the important context."
              className="input-field w-full resize-none rounded-2xl px-3 py-2.5 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              labelText="Priority"
              value={draft.priority}
              onChange={(value) =>
                setDraft((next) => ({ ...next, priority: value as Priority }))
              }
            >
              {priorities.map((priority) => (
                <option key={priority} value={priority}>
                  {friendlyPriority(priority)}
                </option>
              ))}
            </SelectField>
            <TextField
              labelText="Customer"
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
            disabled={!draft.title.trim() || isPending || !canMutate}
            className="btn-primary mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            Create request
          </button>
        </form>
      </div>
    </div>
  );
}

export function TriageConsole({ initialData }: { initialData: DashboardData }) {
  const { data, notice, isPending, runMutation, refresh, createTicket } =
    useDashboardState(initialData);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [showBreachedOnly, setShowBreachedOnly] = useState(false);
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);

  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const activeTickets = data.tickets.filter(isActive);
  const doneTickets = data.tickets.filter((ticket) => !isActive(ticket));
  const breachedTickets = data.tickets.filter((ticket) =>
    isBreachedTicket(ticket, nowMs),
  ).length;

  const filteredTickets = useMemo(() => {
    return data.tickets.filter((ticket) => {
      if (statusFilter === "active" && !isActive(ticket)) return false;
      if (statusFilter !== "active" && statusFilter !== "all") {
        if (ticket.status !== statusFilter) return false;
      }
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) {
        return false;
      }
      if (teamFilter !== "all" && ticket.assignedTeamId !== teamFilter) {
        return false;
      }
      if (showBreachedOnly && !isBreachedTicket(ticket, nowMs)) return false;
      if (query && !ticketMatchesSearch(ticket, query)) return false;
      return true;
    });
  }, [
    data.tickets,
    nowMs,
    priorityFilter,
    query,
    showBreachedOnly,
    statusFilter,
    teamFilter,
  ]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    priorityFilter !== "all" ||
    statusFilter !== "all" ||
    teamFilter !== "all" ||
    showBreachedOnly;

  const needsAttentionTickets = filteredTickets.filter((ticket) => {
    if (!isActive(ticket) || ticket.status === "waiting") return false;
    return (
      ticket.priority === "P1" ||
      ticket.priority === "P2" ||
      ticket.status === "new" ||
      !ticket.assignedUserId ||
      isBreachedTicket(ticket, nowMs)
    );
  });
  const waitingTickets = filteredTickets.filter(
    (ticket) => ticket.status === "waiting",
  );
  const nextUpTickets = filteredTickets.filter((ticket) => {
    if (!isActive(ticket) || ticket.status === "waiting") return false;
    return !needsAttentionTickets.some((item) => item.id === ticket.id);
  });
  const visibleDoneTickets = filteredTickets.filter((ticket) => !isActive(ticket));

  function resetFilters() {
    setQuery("");
    setPriorityFilter("all");
    setStatusFilter("all");
    setTeamFilter("all");
    setShowBreachedOnly(false);
  }

  function submitNewTicket(draft: DraftTicket) {
    runMutation(async () => {
      await createTicket(draft);
    });
    setIsNewTicketOpen(false);
  }

  return (
    <HelpdeskShell
      active="home"
      title="What needs me now"
      subtitle="Home"
      actions={
        <>
          <button
            type="button"
            onClick={() => setIsNewTicketOpen(true)}
            disabled={!canMutate}
            className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New request
          </button>
          <button
            type="button"
            onClick={() => runMutation(() => refresh().then(() => "Refreshed"))}
            disabled={isPending}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60"
          >
            <RotateCcw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </>
      }
    >
      <section className="mx-auto grid max-w-[1080px] gap-5 px-4 py-5 sm:px-6">
        <section className="rounded-[32px] border border-[#e7dfd2] bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[#e8f7f3] px-3 py-1 text-[12px] font-bold text-[#1f6f61] ring-1 ring-[#c7eee4]">
                <Sparkles className="h-3.5 w-3.5" />
                Guided helpdesk
              </div>
              <h2 className="mt-4 max-w-2xl text-2xl font-bold tracking-tight text-[#1f2937] sm:text-3xl">
                Start with the requests that need a person.
              </h2>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#5f625d]">
                The day is grouped into simple work buckets so anyone can see
                what to pick up, what is waiting, and what is already done.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <SummaryCount label="Needs attention" value={needsAttentionTickets.length} />
              <SummaryCount label="Waiting" value={waitingTickets.length} />
              <SummaryCount label="Done" value={doneTickets.length} />
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-[#e7dfd2] bg-white/75 p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="grid gap-1.5">
              <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#737064]">
                Search requests
              </span>
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#737064]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Customer, ticket number, owner, or title"
                  className="input-field h-11 w-full rounded-2xl pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400"
                />
              </span>
            </label>
            <details className="rounded-2xl border border-[#e7dfd2] bg-[#fbfaf7] px-3 py-2">
              <summary className="flex h-7 cursor-pointer list-none items-center justify-between gap-6 text-[13px] font-bold text-[#24324a]">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-[#737064]" />
                  Filters
                </span>
                <span className="text-[12px] text-[#737064]">
                  {hasActiveFilters ? "On" : "Off"}
                </span>
              </summary>
              <div className="mt-3 grid min-w-[min(680px,calc(100vw-3rem))] gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <SelectField labelText="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as FilterStatus)}>
                  <option value="all">All</option>
                  <option value="active">Open only</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {friendlyStatus(status)}
                    </option>
                  ))}
                </SelectField>
                <SelectField labelText="Priority" value={priorityFilter} onChange={(value) => setPriorityFilter(value as "all" | Priority)}>
                  <option value="all">All</option>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {friendlyPriority(priority)}
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
                  <button type="button" onClick={resetFilters} className="btn-soft inline-flex h-11 w-full items-center justify-center rounded-full px-4 text-sm font-bold">
                    Reset
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPriorityFilter("P1");
                    setStatusFilter("active");
                    setTeamFilter("all");
                    setShowBreachedOnly(false);
                  }}
                  className="rounded-full border border-red-100 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 transition hover:bg-red-50"
                >
                  High priority
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPriorityFilter("all");
                    setStatusFilter("active");
                    setTeamFilter("all");
                    setShowBreachedOnly(true);
                  }}
                  className="rounded-full border border-amber-100 bg-white px-3 py-1.5 text-[12px] font-bold text-amber-700 transition hover:bg-amber-50"
                >
                  Due now ({breachedTickets})
                </button>
              </div>
            </details>
          </div>
          <p className="mt-3 text-[12px] font-medium text-[#737064]">
            {filteredTickets.length} shown from {data.tickets.length} total.{" "}
            {activeTickets.length} still open.
          </p>
        </section>

        <div className="grid gap-5">
          <WorkBucket title="Needs attention" helper="Pick from here first. These are new, urgent, unrouted, or due now." tickets={needsAttentionTickets} nowMs={nowMs} emptyMessage="Nothing needs immediate attention." />
          <WorkBucket title="Next up" helper="Open requests that are ready for someone to continue." tickets={nextUpTickets} nowMs={nowMs} emptyMessage="No other open requests match the current filters." />
          <WorkBucket title="Waiting" helper="Requests paused while the team waits for a reply or outside action." tickets={waitingTickets} nowMs={nowMs} emptyMessage="Nothing is waiting right now." />
          <WorkBucket title="Done" helper="Recently completed requests kept nearby for quick review." tickets={visibleDoneTickets} nowMs={nowMs} emptyMessage="No completed requests match the current filters." />
        </div>
      </section>
      <NewTicketModal isOpen={isNewTicketOpen} onClose={() => setIsNewTicketOpen(false)} data={data} onSubmit={submitNewTicket} isPending={isPending} canMutate={canMutate} />
      <Notice message={notice} />
    </HelpdeskShell>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#f7f5f0] p-4 ring-1 ring-[#e7dfd2]">
      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#737064]">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[#24324a]">
        {value}
      </p>
    </div>
  );
}

export function TicketDetailConsole({
  initialData,
  ticketId,
}: {
  initialData: DashboardData;
  ticketId: string;
}) {
  const {
    data,
    notice,
    isPending,
    runMutation,
    refresh,
    checkHealth,
    patchTicket,
    addComment,
  } = useDashboardState(initialData);
  const [note, setNote] = useState("");
  const ticket = data.tickets.find((item) => item.id === ticketId) ?? null;
  const incident = ticket?.incidentId
    ? data.incidents.find((item) => item.id === ticket.incidentId) ?? null
    : null;
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const teamUsers = usersForTeam(data.users, ticket?.assignedTeamId ?? null);

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !note.trim()) return;
    runMutation(async () => {
      await addComment(ticket.id, note);
      setNote("");
      return "Note added";
    });
  }

  return (
    <HelpdeskShell
      active="tickets"
      title={ticket ? "Help this customer" : "Ticket not found"}
      subtitle={ticket ? `TK-${ticket.ticketNumber}` : "Tickets"}
      actions={
        <>
          <HealthButton isLive={isLive} isPending={isPending} onClick={() => runMutation(checkHealth)} />
          <button type="button" onClick={() => runMutation(() => refresh().then(() => "Refreshed"))} disabled={isPending} className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60">
            <RotateCcw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </>
      }
    >
      <section className="mx-auto max-w-[1120px] px-4 py-5 sm:px-6">
        {ticket ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-[32px] border border-[#e7dfd2] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${priorityClass[ticket.priority]}`}>
                  {friendlyPriority(ticket.priority)}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone[ticket.status]}`}>
                  {friendlyStatus(ticket.status)}
                </span>
                <span className="rounded-full bg-[#f7f5f0] px-2.5 py-1 font-mono text-[11px] font-bold text-[#737064] ring-1 ring-[#e7dfd2]">
                  TK-{ticket.ticketNumber}
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1f2937] sm:text-3xl">
                {ticket.title}
              </h2>
              <div className="mt-4 grid gap-3 text-sm text-[#5f625d] sm:grid-cols-2">
                <InfoLine label="Customer" value={ticket.reporterEmail ?? "System alert"} />
                <InfoLine label="Owner" value={ticket.assignee} />
                <InfoLine label="Team" value={ticket.team} />
                <InfoLine label="Due" value={ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "No due time"} />
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <ActionButton
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "in_progress",
                        comment: "Acknowledged from the helpdesk.",
                      });
                      return "Acknowledged";
                    })
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  I am on it
                </ActionButton>
                <button
                  type="button"
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "resolved",
                        comment: "Resolved from the helpdesk.",
                      });
                      return "Marked done";
                    })
                  }
                  className="btn-success inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark done
                </button>
                <ActionButton
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "triaged",
                        comment: "Reopened from the helpdesk.",
                      });
                      return "Reopened";
                    })
                  }
                >
                  <RotateCcw className="h-4 w-4" />
                  Reopen
                </ActionButton>
              </div>
            </section>

            <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-[#1f2937]">Details</h3>
              <div className="mt-4 grid gap-3">
                <SelectField labelText="Status" value={ticket.status} disabled={isPending || !canMutate} onChange={(value) => runMutation(async () => {
                  await patchTicket(ticket.id, { status: value, comment: `Status changed to ${label(value)}.` });
                  return "Status updated";
                })}>
                  {statuses.map((status) => (
                    <option key={status} value={status}>{friendlyStatus(status)}</option>
                  ))}
                </SelectField>
                <SelectField labelText="Priority" value={ticket.priority} disabled={isPending || !canMutate} onChange={(value) => runMutation(async () => {
                  await patchTicket(ticket.id, { priority: value, comment: `Priority changed to ${value}.` });
                  return "Priority updated";
                })}>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>{friendlyPriority(priority)}</option>
                  ))}
                </SelectField>
                <SelectField labelText="Team" value={ticket.assignedTeamId ?? ""} disabled={isPending || !canMutate} onChange={(value) => runMutation(async () => {
                  await patchTicket(ticket.id, { assignedTeamId: value || null, assignedUserId: null, comment: "Team assignment updated." });
                  return "Team updated";
                })}>
                  <option value="">Unrouted</option>
                  {data.teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </SelectField>
                <SelectField labelText="Owner" value={ticket.assignedUserId ?? ""} disabled={isPending || !canMutate} onChange={(value) => runMutation(async () => {
                  await patchTicket(ticket.id, { assignedUserId: value || null, comment: "Owner assignment updated." });
                  return "Owner updated";
                })}>
                  <option value="">Unassigned</option>
                  {teamUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.fullName ?? user.email}</option>
                  ))}
                </SelectField>
              </div>
            </section>

            <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm lg:col-span-2">
              <h3 className="text-lg font-bold text-[#1f2937]">Request</h3>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-[#5f625d]">
                {ticket.description || "No notes were included yet."}
              </p>
            </section>

            <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-[#1f2937]">Notes</h3>
              <form onSubmit={submitNote} className="mt-4 grid gap-3">
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={5}
                  placeholder="Add a helpful update..."
                  disabled={isPending || !canMutate}
                  className="input-field w-full resize-none rounded-2xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50"
                />
                <button type="submit" disabled={!note.trim() || isPending || !canMutate} className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60">
                  <MessageSquarePlus className="h-4 w-4" />
                  Add note
                </button>
              </form>
            </section>

            <IncidentContext ticket={ticket} incident={incident} />
            <Timeline ticket={ticket} />
          </div>
        ) : (
          <div className="grid min-h-[520px] place-items-center rounded-[32px] border border-[#e7dfd2] bg-white p-8 text-center shadow-sm">
            <div>
              <Sparkles className="mx-auto h-10 w-10 text-[#8dd6c6]" />
              <p className="mt-4 text-lg font-bold text-[#1f2937]">Ticket not found</p>
              <p className="mt-1 text-sm text-[#737064]">
                It may have been closed or removed from the current dashboard.
              </p>
              <Link href="/" className="btn-primary mt-5 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-bold">
                Back home
              </Link>
            </div>
          </div>
        )}
      </section>
      <Notice message={notice} />
    </HelpdeskShell>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f7f5f0] px-4 py-3 ring-1 ring-[#e7dfd2]">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#737064]">
        {label}
      </p>
      <p className="mt-1 truncate font-bold text-[#1f2937]">{value}</p>
    </div>
  );
}

function IncidentContext({
  ticket,
  incident,
}: {
  ticket: TicketQueueItem;
  incident: IncidentSnapshot | null;
}) {
  return (
    <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-[#1f2937]">Incident context</h3>
      <div className="mt-4 grid gap-3 text-sm">
        <InfoLine label="Duplicates" value={String(ticket.duplicateCount)} />
        <InfoLine label="Score" value={`${ticket.importanceScore} x ${ticket.urgencyScore}`} />
        <InfoLine label="Source" value={ticket.createdFrom} />
        {incident ? (
          <p className="rounded-2xl bg-[#fbfaf7] p-4 leading-6 text-[#5f625d] ring-1 ring-[#e7dfd2]">
            {incident.blastCount} linked alerts with confidence{" "}
            {incident.confidence ?? "n/a"}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Timeline({ ticket }: { ticket: TicketQueueItem }) {
  return (
    <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[#1f2937]">Activity</h3>
        <span className="rounded-full bg-[#f7f5f0] px-3 py-1 text-[12px] font-bold text-[#737064] ring-1 ring-[#e7dfd2]">
          {ticket.comments.length} notes
        </span>
      </div>
      <div className="mt-5 grid gap-4">
        {ticket.comments.length > 0 ? (
          ticket.comments.map((item) => (
            <div key={item.id} className="rounded-2xl bg-[#fbfaf7] p-4 ring-1 ring-[#e7dfd2]">
              <p className="text-[14px] leading-6 text-[#1f2937]">{item.body}</p>
              <p className="mt-2 text-[12px] font-medium text-[#737064]">
                {item.authorEmail ?? "system"} / {formatDateTime(item.createdAt)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-[#737064]">No notes yet.</p>
        )}
      </div>
    </section>
  );
}

export function OverviewConsole({ initialData }: { initialData: DashboardData }) {
  const { data, notice, isPending, runMutation, refresh, checkHealth } =
    useDashboardState(initialData);
  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const activeTickets = data.tickets.filter(isActive);
  const waitingTickets = data.tickets.filter((ticket) => ticket.status === "waiting");
  const breachedTickets = data.tickets.filter((ticket) => isBreachedTicket(ticket, nowMs));
  const doneTickets = data.tickets.filter((ticket) => !isActive(ticket));

  return (
    <HelpdeskShell
      active="overview"
      title="Team overview"
      subtitle="Overview"
      actions={
        <>
          <HealthButton isLive={isLive} isPending={isPending} onClick={() => runMutation(checkHealth)} />
          <button type="button" onClick={() => runMutation(() => refresh().then(() => "Refreshed"))} disabled={isPending} className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60">
            <RotateCcw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </>
      }
    >
      <section className="mx-auto grid max-w-[1120px] gap-5 px-4 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCount label="Open requests" value={activeTickets.length} />
          <SummaryCount label="Need attention" value={breachedTickets.length} />
          <SummaryCount label="Waiting" value={waitingTickets.length} />
          <SummaryCount label="Done" value={doneTickets.length} />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#1f2937]">Team rhythm</h2>
            <div className="mt-4 grid gap-3">
              {data.teamLoad.map((team) => (
                <div key={team.team} className="rounded-2xl bg-[#fbfaf7] p-4 ring-1 ring-[#e7dfd2]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-[#1f2937]">{team.team}</span>
                    <span className="text-sm font-bold tabular-nums text-[#737064]">
                      {team.openTickets} open
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ebe4d9]">
                    <div className="h-full rounded-full bg-[#8dd6c6]" style={{ width: `${Math.min(100, team.openTickets * 16)}%` }} />
                  </div>
                  <p className="mt-2 text-[12px] text-[#737064]">
                    {team.urgentTickets} urgent, {team.members} members
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#1f2937]">Due now</h2>
            <div className="mt-4 grid gap-3">
              {breachedTickets.length > 0 ? (
                breachedTickets.slice(0, 5).map((ticket) => (
                  <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
                ))
              ) : (
                <p className="rounded-2xl bg-[#fbfaf7] p-4 text-sm text-[#737064] ring-1 ring-[#e7dfd2]">
                  Nothing is overdue.
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#1f2937]">Recent activity</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.tickets.slice(0, 8).map((ticket) => (
              <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
            ))}
          </div>
        </section>
      </section>
      <Notice message={notice} />
    </HelpdeskShell>
  );
}

const exampleProviders = [
  {
    id: "generic",
    label: "Generic webhook",
    payload: {
      source: "monitor",
      id: "alert-123",
      from: "alerts@example.com",
      subject: "Checkout latency above threshold",
      body: "Customer-facing checkout latency is breaching SLA.",
      service: "checkout-api",
      severity: "critical",
    },
  },
  {
    id: "resend",
    label: "Resend email",
    payload: {
      type: "email.received",
      data: {
        email_id: "rs_test_123",
        from: "alerts@example.com",
        to: ["alerts@yourdomain.com"],
        subject: "Checkout latency above threshold",
        text: "Customer-facing checkout latency is breaching SLA.",
      },
    },
  },
];

export function SettingsConsole() {
  const [integrationTest, setIntegrationTest] = useState({
    webhookUrl: "",
    apiKey: "",
    subject: "Integration smoke alert",
  });
  const [exampleId, setExampleId] = useState(exampleProviders[0].id);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  async function copyText(value: string, labelText: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      setNotice(`${labelText} copied`);
    } catch {
      setNotice(`${labelText}: ${value}`);
    }
  }

  async function checkHealth() {
    const response = await fetch("/api/health", { cache: "no-store" });
    const result = (await response.json()) as {
      ok?: boolean;
      database?: string;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Health check failed");
    }
    return `Health ok: database ${result.database ?? "unknown"}`;
  }

  async function testIntegration() {
    const response = await fetch("/api/integration-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrationTest),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      status?: number;
      ticketNumber?: string | null;
    };
    if (!response.ok || !result.ok) {
      const status = result.status ? ` (${result.status})` : "";
      throw new Error(`${result.error ?? "Integration test failed"}${status}`);
    }
    return result.ticketNumber
      ? `Test request created TK-${result.ticketNumber}`
      : "Webhook test accepted";
  }

  function submitIntegrationTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(testIntegration);
  }

  function copyWebhookUrl() {
    void copyText(
      `${window.location.origin}/api/webhooks/inbound-email`,
      "Webhook URL",
    );
  }

  const example =
    exampleProviders.find((entry) => entry.id === exampleId) ??
    exampleProviders[0];

  return (
    <HelpdeskShell
      active="settings"
      title="Settings"
      subtitle="Guided setup"
      actions={
        <button type="button" onClick={() => runMutation(checkHealth)} disabled={isPending} className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-bold disabled:opacity-60">
          <ShieldCheck className="h-4 w-4" />
          Check setup
        </button>
      }
    >
      <section className="mx-auto grid max-w-[920px] gap-5 px-4 py-5 sm:px-6">
        <SetupCard icon={<Database className="h-5 w-5" />} title="Receive requests by email" helper="Send inbound email events to this webhook so alerts become tickets.">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <code className="rounded-2xl bg-[#fbfaf7] px-3 py-3 font-mono text-[12px] text-[#1f2937] ring-1 ring-[#e7dfd2]">
              POST /api/webhooks/inbound-email
            </code>
            <button type="button" onClick={copyWebhookUrl} className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold">
              <Send className="h-4 w-4" />
              Copy URL
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#737064]">
            Use your inbound webhook secret or Resend webhook secret in Vercel
            environment variables before sending live mail.
          </p>
        </SetupCard>

        <SetupCard icon={<RadioTower className="h-5 w-5" />} title="Send a test request" helper="Post a synthetic alert to confirm routing before relying on it.">
          <form onSubmit={submitIntegrationTest} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField labelText="Webhook URL" value={integrationTest.webhookUrl} onChange={(value) => setIntegrationTest((next) => ({ ...next, webhookUrl: value }))} placeholder="/api/webhooks/inbound-email" />
            </div>
            <TextField labelText="Secret" type="password" value={integrationTest.apiKey} onChange={(value) => setIntegrationTest((next) => ({ ...next, apiKey: value }))} placeholder="Optional" />
            <TextField labelText="Subject" value={integrationTest.subject} onChange={(value) => setIntegrationTest((next) => ({ ...next, subject: value }))} placeholder="Integration smoke alert" />
            <button type="submit" disabled={isPending} className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60 sm:col-span-2">
              <Send className="h-4 w-4" />
              Send test request
            </button>
          </form>
        </SetupCard>

        <SetupCard icon={<AlertTriangle className="h-5 w-5" />} title="Example messages" helper="Use a sample payload when checking a provider sandbox.">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField labelText="Provider" value={exampleId} onChange={setExampleId}>
              {exampleProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </SelectField>
            <div className="flex items-end">
              <button type="button" onClick={() => void copyText(JSON.stringify(example.payload, null, 2), `${example.label} payload`)} className="btn-soft inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-bold">
                <Send className="h-4 w-4" />
                Copy payload
              </button>
            </div>
          </div>
          <pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-[#fbfaf7] px-3 py-3 font-mono text-[12px] leading-5 text-[#1f2937] ring-1 ring-[#e7dfd2]">
            {JSON.stringify(example.payload, null, 2)}
          </pre>
        </SetupCard>
      </section>
      <Notice message={notice} />
    </HelpdeskShell>
  );
}

function SetupCard({
  icon,
  title,
  helper,
  children,
}: {
  icon: ReactNode;
  title: string;
  helper: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[28px] border border-[#e7dfd2] bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8f7f3] text-[#1f6f61] ring-1 ring-[#c7eee4]">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-bold text-[#1f2937]">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-[#737064]">{helper}</p>
        </div>
      </div>
      {children}
    </article>
  );
}
