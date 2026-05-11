"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock3,
  Gauge,
  Inbox,
  LayoutDashboard,
  MessageSquarePlus,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import type {
  DashboardData,
  IncidentSnapshot,
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

const priorityClass: Record<Priority, string> = {
  P1: "priority-p1",
  P2: "priority-p2",
  P3: "priority-p3",
  P4: "priority-p4",
};

const priorityRail: Record<Priority, string> = {
  P1: "priority-rail-p1",
  P2: "priority-rail-p2",
  P3: "priority-rail-p3",
  P4: "priority-rail-p4",
};

const statusTone: Record<TicketStatus, string> = {
  new: "bg-white text-slate-700 ring-1 ring-slate-200",
  triaged: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  assigned: "bg-white text-slate-700 ring-1 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
  waiting: "bg-white text-slate-600 ring-1 ring-slate-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  closed: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

const metricIcons: Record<OpsMetric["key"], typeof RadioTower> = {
  openTickets: RadioTower,
  p1Incidents: AlertTriangle,
  slaBreaches: Clock3,
  avgAge: Gauge,
};

const metricAccent: Record<
  OpsMetric["key"],
  { ring: string; glow: string; icon: string; label: string }
> = {
  openTickets: {
    ring: "ring-slate-200",
    glow: "from-white via-white to-white",
    icon: "bg-blue-600 text-white",
    label: "text-slate-500",
  },
  p1Incidents: {
    ring: "ring-slate-200",
    glow: "from-white via-white to-white",
    icon: "bg-red-600 text-white",
    label: "text-slate-500",
  },
  slaBreaches: {
    ring: "ring-slate-200",
    glow: "from-white via-white to-white",
    icon: "bg-amber-500 text-white",
    label: "text-slate-500",
  },
  avgAge: {
    ring: "ring-slate-200",
    glow: "from-white via-white to-white",
    icon: "bg-slate-700 text-white",
    label: "text-slate-500",
  },
};

type FilterStatus = "active" | "all" | TicketStatus;

type DraftTicket = {
  title: string;
  description: string;
  reporterEmail: string;
  priority: Priority;
  assignedTeamId: string;
  assignedUserId: string;
};

const emptyDraft: DraftTicket = {
  title: "",
  description: "",
  reporterEmail: "",
  priority: "P3",
  assignedTeamId: "",
  assignedUserId: "",
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

function priorityIcon(priority: Priority) {
  if (priority === "P1") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (priority === "P2") return <RadioTower className="h-3.5 w-3.5" />;
  return <CircleDot className="h-3.5 w-3.5" />;
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
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field h-10 w-full min-w-0 px-3 text-sm font-medium normal-case tracking-normal text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
      {labelText}
      <input
        type={type}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field h-10 w-full min-w-0 px-3 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function AppHeader({
  title,
  subtitle = "Alert Triage",
  active,
  actions,
}: {
  title: string;
  subtitle?: string;
  active: "queue" | "overview" | "settings";
  actions?: ReactNode;
}) {
  const links = [
    { href: "/", label: "Queue", key: "queue" as const, icon: Inbox },
    {
      href: "/overview",
      label: "Overview",
      key: "overview" as const,
      icon: LayoutDashboard,
    },
    {
      href: "/settings",
      label: "Settings",
      key: "settings" as const,
      icon: Settings,
    },
  ];

  return (
    <header className="glass-header sticky top-0 z-20 border-b border-slate-200">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-600 text-white"
            aria-label="Open queue"
          >
            <Bell className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {subtitle}
            </p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">
              {title}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex rounded-md border border-slate-200 bg-white p-0.5">
            {links.map((link) => {
              const Icon = link.icon;
              const isActiveLink = active === link.key;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex h-8 items-center justify-center gap-2 rounded px-3 text-[12.5px] font-semibold transition ${
                    isActiveLink
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
          {actions}
        </div>
      </div>
    </header>
  );
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-lg">
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
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-[12.5px] font-semibold disabled:opacity-60 ${
        isLive
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          isLive ? "bg-emerald-500 ring-pulse" : "bg-amber-500 pulse-soft"
        }`}
      />
      <ShieldCheck className="h-4 w-4" />
      {isLive ? "Live" : "Demo"}
    </button>
  );
}

function MetricCard({
  metric,
  onActivate,
  active,
}: {
  metric: OpsMetric;
  onActivate?: () => void;
  active?: boolean;
}) {
  const Icon = metricIcons[metric.key];
  const accent = metricAccent[metric.key];
  const Tag = onActivate ? "button" : "div";

  return (
    <Tag
      type={onActivate ? "button" : undefined}
      onClick={onActivate}
      aria-pressed={onActivate ? active : undefined}
      className={`surface-card p-4 text-left ring-1 ${accent.ring} ${
        onActivate ? "transition hover:border-slate-300" : ""
      } ${active ? "outline outline-2 outline-offset-2 outline-blue-600" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${accent.label}`}
          >
            {metric.label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 tabular-nums">
            {metric.value}
          </p>
        </div>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${accent.icon}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 border-t border-slate-200 pt-3 text-sm leading-5 text-slate-500">
        {metric.detail}
      </p>
    </Tag>
  );
}

function TicketListItem({
  ticket,
  nowMs,
}: {
  ticket: TicketQueueItem;
  nowMs: number;
}) {
  const isBreached = isBreachedTicket(ticket, nowMs);

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="relative block w-full border-b border-slate-200 bg-white px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50 sm:px-5"
    >
      <span
        className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full ${priorityRail[ticket.priority]}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold ${priorityClass[ticket.priority]}`}
            >
              {priorityIcon(ticket.priority)}
              {ticket.priority}
            </span>
            <span
              className={`inline-flex h-6 items-center rounded px-2 text-[11px] font-semibold capitalize ${statusTone[ticket.status]}`}
            >
              {label(ticket.status)}
            </span>
            {isBreached ? (
              <span className="inline-flex h-6 items-center gap-1 rounded bg-red-50 px-2 text-[11px] font-semibold text-red-700 ring-1 ring-red-100">
                <Clock3 className="h-3 w-3" />
                breach
              </span>
            ) : null}
          </div>
          <h2 className="line-clamp-2 text-[13.5px] font-semibold leading-5 text-slate-950">
            {ticket.title}
          </h2>
        </div>
        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-slate-600">
          TK-{ticket.ticketNumber}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="truncate">{ticket.team}</span>
        <span className="truncate">{ticket.assignee}</span>
        <span
          className={`font-semibold tabular-nums ${
            isBreached ? "text-red-700" : "text-slate-600"
          }`}
        >
          {ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "No SLA"}
        </span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 ring-1 ring-slate-200">
        <Search className="h-5 w-5 text-slate-500" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-900">
        No tickets match
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Adjust filters or create one manually.
      </p>
    </div>
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

  useEffect(() => {
    if (!isOpen) return;
    const focusTimeout = window.setTimeout(() => titleRef.current?.focus(), 50);
    return () => window.clearTimeout(focusTimeout);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(emptyDraft);
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const draftTeamUsers = usersForTeam(data.users, draft.assignedTeamId || null);

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
      aria-labelledby="new-ticket-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onClick={resetAndClose}
    >
      <div
        className="surface-card max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="new-ticket-title"
              className="text-[15px] font-semibold tracking-tight text-slate-950"
            >
              New ticket
            </h2>
            <p className="text-[12.5px] text-slate-500">Create a live ticket</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <TextField
            labelText="Title"
            inputRef={titleRef}
            value={draft.title}
            onChange={(value) => setDraft((next) => ({ ...next, title: value }))}
            placeholder="Short incident title"
          />
          <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
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
              className="input-field w-full min-w-0 resize-none px-3 py-2.5 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
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
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={resetAndClose}
              className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draft.title.trim() || isPending || !canMutate}
              className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              Create ticket
            </button>
          </div>
        </form>
      </div>
    </div>
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
      : "Ticket created";
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
      throw new Error(result.error ?? "Unable to add comment");
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

export function TriageConsole({ initialData }: { initialData: DashboardData }) {
  const {
    data,
    notice,
    isPending,
    runMutation,
    refresh,
    createTicket,
  } = useDashboardState(initialData);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [teamFilter, setTeamFilter] = useState("all");
  const [showBreachedOnly, setShowBreachedOnly] = useState(false);
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);

  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const activeTickets = data.tickets.filter(isActive).length;
  const breachedTickets = data.tickets.filter((ticket) =>
    isBreachedTicket(ticket, nowMs),
  ).length;

  function resetFilters() {
    setQuery("");
    setPriorityFilter("all");
    setStatusFilter("active");
    setTeamFilter("all");
    setShowBreachedOnly(false);
  }

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

  function submitNewTicket(draft: DraftTicket) {
    runMutation(async () => {
      await createTicket(draft);
    });
    setIsNewTicketOpen(false);
  }

  const hasActiveFilters =
    query.trim().length > 0 ||
    priorityFilter !== "all" ||
    statusFilter !== "active" ||
    teamFilter !== "all" ||
    showBreachedOnly;

  return (
    <main className="min-h-screen overflow-x-hidden text-slate-900">
      <AppHeader
        title="Inbox"
        active="queue"
        actions={
          <>
            <button
              type="button"
              onClick={() => setIsNewTicketOpen(true)}
              disabled={!canMutate}
              className="btn-soft inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              New ticket
            </button>
            <button
              type="button"
              onClick={() =>
                runMutation(() => refresh().then(() => "Refreshed"))
              }
              disabled={isPending}
              className="btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-60"
            >
              <RotateCcw
                className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </>
        }
      />

      <section className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <section className="surface-card overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                  <Inbox className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                    Tickets
                  </h2>
                  <p className="text-[12.5px] text-slate-500">
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {activeTickets}
                    </span>{" "}
                    active ·{" "}
                    <span className="tabular-nums">{filteredTickets.length}</span>{" "}
                    shown
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/overview"
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                >
                  Overview
                </Link>
              </div>
            </div>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tickets"
                className="input-field h-10 w-full min-w-0 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] font-semibold text-slate-700">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                  Filters
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {hasActiveFilters ? "Active" : "Default"}
                </span>
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
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
                    onClick={resetFilters}
                    className="btn-soft inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"
                  >
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
                  className="rounded-md border border-red-100 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                >
                  P1 only
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
                  className="rounded-md border border-amber-100 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50"
                >
                  SLA breaches ({breachedTickets})
                </button>
              </div>
            </details>
          </div>
          <div>
            {filteredTickets.length > 0 ? (
              filteredTickets.map((ticket) => (
                <TicketListItem key={ticket.id} ticket={ticket} nowMs={nowMs} />
              ))
            ) : (
              <EmptyState />
            )}
          </div>
        </section>
      </section>

      <NewTicketModal
        isOpen={isNewTicketOpen}
        onClose={() => setIsNewTicketOpen(false)}
        data={data}
        onSubmit={submitNewTicket}
        isPending={isPending}
        canMutate={canMutate}
      />
      <Notice message={notice} />
    </main>
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
  const [comment, setComment] = useState("");

  const ticket = data.tickets.find((item) => item.id === ticketId) ?? null;
  const incident = ticket?.incidentId
    ? data.incidents.find((item) => item.id === ticket.incidentId) ?? null
    : null;
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const teamUsers = usersForTeam(data.users, ticket?.assignedTeamId ?? null);

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !comment.trim()) return;
    runMutation(async () => {
      await addComment(ticket.id, comment);
      setComment("");
      return "Comment added";
    });
  }

  return (
    <main className="min-h-screen overflow-x-hidden text-slate-900">
      <AppHeader
        title={ticket ? `TK-${ticket.ticketNumber}` : "Ticket not found"}
        active="queue"
        actions={
          <>
            <HealthButton
              isLive={isLive}
              isPending={isPending}
              onClick={() => runMutation(checkHealth)}
            />
            <Link
              href="/"
              className="btn-soft inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-semibold"
            >
              <ArrowLeft className="h-4 w-4" />
              Queue
            </Link>
            <button
              type="button"
              onClick={() =>
                runMutation(() => refresh().then(() => "Refreshed"))
              }
              disabled={isPending}
              className="btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-60"
            >
              <RotateCcw
                className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </>
        }
      />

      <section className="mx-auto max-w-[1040px] px-4 py-6 sm:px-6">
        {ticket ? (
          <article className="surface-card overflow-hidden">
            <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-semibold ${priorityClass[ticket.priority]}`}
                    >
                      {priorityIcon(ticket.priority)}
                      {ticket.priority}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[11px] tracking-wide text-slate-600 ring-1 ring-slate-200">
                      TK-{ticket.ticketNumber}
                    </span>
                    <span className={`inline-flex h-7 items-center rounded px-2 text-[11px] font-semibold capitalize ${statusTone[ticket.status]}`}>
                      {label(ticket.status)}
                    </span>
                    <span className="inline-flex h-7 items-center rounded bg-slate-50 px-2 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                      {ticket.createdFrom}
                    </span>
                  </div>
                  <h2 className="mt-4 max-w-3xl text-[24px] font-semibold leading-[1.2] tracking-tight text-slate-950">
                    {ticket.title}
                  </h2>
                  <p className="mt-3 max-w-3xl text-[14px] leading-6 text-slate-600">
                    {ticket.description || "No description yet."}
                  </p>
                  <p className="mt-3 text-[12px] text-slate-500">
                    Reported by{" "}
                    <span className="font-medium text-slate-800">
                      {ticket.reporterEmail ?? "system alert"}
                    </span>
                    {" · "}
                    <span className="tabular-nums">
                      {formatDateTime(ticket.createdAt)}
                    </span>
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Last refresh
                  </p>
                  <p className="mt-1 text-[12.5px] font-semibold tabular-nums text-slate-800">
                    {formatDateTime(data.refreshedAt)}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid gap-3 md:grid-cols-3">
                <button
                  type="button"
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "in_progress",
                        comment: "Acknowledged from the console.",
                      });
                      return "Acknowledged";
                    })
                  }
                  className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Acknowledge
                </button>
                <button
                  type="button"
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "resolved",
                        comment: "Resolved from the console.",
                      });
                      return "Resolved";
                    })
                  }
                  className="btn-success inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Resolve
                </button>
                <button
                  type="button"
                  disabled={isPending || !canMutate}
                  onClick={() =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: "triaged",
                        comment: "Reopened from the console.",
                      });
                      return "Reopened";
                    })
                  }
                  className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" />
                  Reopen
                </button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <SelectField
                  labelText="Status"
                  value={ticket.status}
                  disabled={isPending || !canMutate}
                  onChange={(value) =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
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
                  value={ticket.priority}
                  disabled={isPending || !canMutate}
                  onChange={(value) =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
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
                  value={ticket.assignedTeamId ?? ""}
                  disabled={isPending || !canMutate}
                  onChange={(value) =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
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
                  value={ticket.assignedUserId ?? ""}
                  disabled={isPending || !canMutate}
                  onChange={(value) =>
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        assignedUserId: value || null,
                        comment: "Owner assignment updated.",
                      });
                      return "Owner updated";
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {teamUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName ?? user.email}
                    </option>
                  ))}
                </SelectField>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <form onSubmit={submitComment} className="space-y-3">
                  <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Comment
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={5}
                      placeholder="Add an update for the team..."
                      disabled={isPending || !canMutate}
                      className="input-field w-full min-w-0 resize-none px-3 py-2.5 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!comment.trim() || isPending || !canMutate}
                    className="btn-soft inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    Add comment
                  </button>
                </form>

                <IncidentShape ticket={ticket} incident={incident} />
              </div>

              <TicketTimeline ticket={ticket} />
            </div>
          </article>
        ) : (
          <div className="surface-card grid min-h-[520px] place-items-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="mt-4 text-[15px] font-semibold tracking-tight text-slate-950">
                Ticket not found
              </p>
              <p className="mt-1 text-sm text-slate-500">
                It may have been closed or removed from the current dashboard.
              </p>
              <Link
                href="/"
                className="btn-primary mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to queue
              </Link>
            </div>
          </div>
        )}
      </section>
      <Notice message={notice} />
    </main>
  );
}

function IncidentShape({
  ticket,
  incident,
}: {
  ticket: TicketQueueItem;
  incident: IncidentSnapshot | null;
}) {
  return (
    <div className="surface-inset p-4">
      <p className="text-[13px] font-semibold tracking-tight text-slate-950">
        Incident shape
      </p>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Duplicates</span>
          <span className="rounded bg-white px-2 py-0.5 font-semibold tabular-nums text-slate-900 ring-1 ring-slate-200">
            {ticket.duplicateCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Score</span>
          <span className="rounded bg-white px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-slate-900 ring-1 ring-slate-200">
            {ticket.importanceScore} x {ticket.urgencyScore}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">SLA</span>
          <span className="font-semibold tabular-nums text-slate-900">
            {ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "Not set"}
          </span>
        </div>
        {incident ? (
          <div className="border-t border-slate-200 pt-3 text-[12.5px] leading-5 text-slate-600">
            <span className="font-semibold text-slate-800">
              {incident.blastCount}
            </span>{" "}
            linked alerts, confidence{" "}
            <span className="font-semibold text-slate-800">
              {incident.confidence ?? "n/a"}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TicketTimeline({ ticket }: { ticket: TicketQueueItem }) {
  return (
    <div className="mt-7 border-t border-slate-200 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold tracking-tight text-slate-950">
          Timeline
        </h3>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
          {ticket.comments.length} comments
        </span>
      </div>
      <div className="space-y-5">
        {ticket.comments.length > 0 ? (
          ticket.comments.map((item, index) => (
            <div key={item.id} className="relative grid gap-2 pl-6">
              <span
                aria-hidden
                className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-slate-500 ring-4 ring-slate-100"
              />
              {index < ticket.comments.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute left-[10px] top-4 h-[calc(100%+0.75rem)] w-px bg-slate-200"
                />
              ) : null}
              <p className="text-[14px] leading-6 text-slate-900">
                {item.body}
              </p>
              <p className="text-[11.5px] text-slate-500">
                <span className="font-medium text-slate-700">
                  {item.authorEmail ?? "system"}
                </span>{" "}
                ·{" "}
                <span className="tabular-nums">
                  {formatDateTime(item.createdAt)}
                </span>
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No comments yet.</p>
        )}
      </div>
    </div>
  );
}

export function OverviewConsole({ initialData }: { initialData: DashboardData }) {
  const { data, notice, isPending, runMutation, refresh, checkHealth } =
    useDashboardState(initialData);
  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const breachedTickets = data.tickets.filter((ticket) =>
    isBreachedTicket(ticket, nowMs),
  );
  const recentTickets = data.tickets.slice(0, 8);

  return (
    <main className="min-h-screen overflow-x-hidden text-slate-900">
      <AppHeader
        title="Operations overview"
        active="overview"
        actions={
          <>
            <HealthButton
              isLive={isLive}
              isPending={isPending}
              onClick={() => runMutation(checkHealth)}
            />
            <button
              type="button"
              onClick={() =>
                runMutation(() => refresh().then(() => "Refreshed"))
              }
              disabled={isPending}
              className="btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-60"
            >
              <RotateCcw
                className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </>
        }
      />

      <section className="mx-auto grid max-w-[1180px] gap-5 px-4 py-6 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((metric) => (
            <MetricCard
              key={metric.key}
              metric={
                metric.key === "slaBreaches"
                  ? { ...metric, value: String(breachedTickets.length) }
                  : metric
              }
            />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-700 ring-1 ring-red-100">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">
                    SLA breach watch
                  </h2>
                  <p className="text-[12.5px] text-slate-500">
                    Past due active tickets that need attention.
                  </p>
                </div>
              </div>
            </div>
            <div>
              {breachedTickets.length > 0 ? (
                breachedTickets.map((ticket) => (
                  <TicketListItem key={ticket.id} ticket={ticket} nowMs={nowMs} />
                ))
              ) : (
                <div className="px-5 py-12 text-center text-sm text-slate-500">
                  No active SLA breaches.
                </div>
              )}
            </div>
          </section>

          <section className="surface-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">
                  Team load
                </h2>
                <p className="text-[12.5px] text-slate-500">
                  Current open work by team.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {data.teamLoad.map((team) => (
                <div
                  key={team.team}
                  className="rounded-md border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">
                      {team.team}
                    </span>
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-500">
                      {team.openTickets} open
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{
                        width: `${Math.min(100, team.openTickets * 16)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[12px] text-slate-500">
                    {team.urgentTickets} urgent, {team.members} members
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="surface-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">
                  Incident snapshots
                </h2>
                <p className="text-[12.5px] text-slate-500">
                  Open incident clusters and duplicate pressure.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {data.incidents.map((incident) => (
                <Link
                  key={incident.id}
                  href={`/#incident-${incident.id}`}
                  className="block rounded-md border border-slate-200 bg-white p-3 transition hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold ${priorityClass[incident.priority]}`}
                    >
                      {priorityIcon(incident.priority)}
                      {incident.priority}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold capitalize text-slate-600 ring-1 ring-slate-200">
                      {incident.status}
                    </span>
                  </div>
                  <p className="mt-2 text-[13.5px] font-semibold leading-5 text-slate-900">
                    {incident.title}
                  </p>
                  <p className="mt-2 text-[12px] text-slate-500">
                    {incident.blastCount} linked alerts, last seen{" "}
                    {formatDateTime(incident.lastSeenAt)}
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <section className="surface-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <Inbox className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">
                  Recent queue movement
                </h2>
                <p className="text-[12.5px] text-slate-500">
                  Latest tickets by update time.
                </p>
              </div>
            </div>
            <div className="mt-5 divide-y divide-slate-200">
              {recentTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition hover:text-slate-950"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-slate-900">
                      {ticket.title}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      {ticket.team} · {ticket.assignee}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-500">
                    TK-{ticket.ticketNumber}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </section>
      <Notice message={notice} />
    </main>
  );
}
