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
import { useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
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
  new: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200/80",
  triaged: "bg-sky-50 text-sky-700 ring-1 ring-sky-200/80",
  assigned: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80",
  in_progress: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80",
  waiting: "bg-stone-100 text-stone-700 ring-1 ring-stone-200/80",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
  closed: "bg-stone-100 text-stone-500 ring-1 ring-stone-200/80",
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
    ring: "ring-sky-200/70",
    glow: "from-sky-100 via-white to-white",
    icon: "bg-gradient-to-br from-sky-500 to-sky-700 text-white",
    label: "text-sky-700",
  },
  p1Incidents: {
    ring: "ring-red-200/70",
    glow: "from-red-100 via-white to-white",
    icon: "bg-gradient-to-br from-red-500 to-red-700 text-white",
    label: "text-red-700",
  },
  slaBreaches: {
    ring: "ring-amber-200/70",
    glow: "from-amber-100 via-white to-white",
    icon: "bg-gradient-to-br from-amber-400 to-amber-600 text-white",
    label: "text-amber-700",
  },
  avgAge: {
    ring: "ring-emerald-200/70",
    glow: "from-emerald-100 via-white to-white",
    icon: "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white",
    label: "text-emerald-700",
  },
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
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field h-10 w-full min-w-0 px-3 text-sm font-medium normal-case tracking-normal text-stone-900 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
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
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
      {labelText}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field h-10 w-full min-w-0 px-3 text-sm normal-case tracking-normal text-stone-900 placeholder:text-stone-400"
      />
    </label>
  );
}

function MetricCard({
  metric,
  onActivate,
  active,
}: {
  metric: OpsMetric;
  onActivate: () => void;
  active: boolean;
}) {
  const Icon = metricIcons[metric.key];
  const accent = metricAccent[metric.key];

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-pressed={active}
      className={`surface-card group relative overflow-hidden p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(20,14,5,0.35)] ring-1 ${accent.ring} ${
        active ? "outline outline-2 outline-offset-2 outline-stone-950" : ""
      }`}
    >
      <div
        className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br ${accent.glow} opacity-70 blur-2xl transition duration-500 group-hover:opacity-90`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${accent.label}`}>
            {metric.label}
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-stone-950 tabular-nums">
            {metric.value}
          </p>
        </div>
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-md ring-1 ring-black/5 ${accent.icon}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="relative mt-4 border-t border-stone-200/70 pt-3 text-sm leading-5 text-stone-500">
        {metric.detail}
      </p>
    </button>
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
  const isBreached = isBreachedTicket(ticket, nowMs);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full border-b border-stone-200/70 px-5 py-4 text-left transition-colors duration-200 last:border-b-0 ${
        selected
          ? "bg-gradient-to-r from-stone-50 to-white"
          : "bg-white hover:bg-stone-50/60"
      }`}
    >
      <span
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${priorityRail[ticket.priority]} ${
          selected ? "" : "opacity-80"
        }`}
      />
      {selected ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 w-[3px] rounded-l bg-stone-900" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ${priorityClass[ticket.priority]}`}
            >
              {priorityIcon(ticket.priority)}
              {ticket.priority}
            </span>
            <span
              className={`inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold capitalize ${statusTone[ticket.status]}`}
            >
              {label(ticket.status)}
            </span>
            {isBreached ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-md bg-red-50 px-2 text-[11px] font-semibold text-red-700 ring-1 ring-red-200/80">
                <Clock3 className="h-3 w-3" />
                breach
              </span>
            ) : null}
          </div>
          <h2 className="line-clamp-2 text-[13.5px] font-semibold leading-5 text-stone-900">
            {ticket.title}
          </h2>
        </div>
        <span className="shrink-0 rounded-md bg-stone-900 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-stone-50">
          TK-{ticket.ticketNumber}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div className="min-w-0">
          <p className="font-semibold uppercase tracking-[0.08em] text-stone-400">
            Owner
          </p>
          <p className="mt-1 truncate font-medium text-stone-700">
            {ticket.assignee}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-semibold uppercase tracking-[0.08em] text-stone-400">
            SLA
          </p>
          <p
            className={`mt-1 truncate font-semibold tabular-nums ${
              isBreached ? "text-red-700" : "text-stone-700"
            }`}
          >
            {ticket.slaDueAt ? formatDateTime(ticket.slaDueAt) : "Not set"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-stone-500">
        <span className="truncate">{ticket.team}</span>
        <span className="shrink-0 font-mono tabular-nums text-stone-400">
          {ticket.importanceScore} × {ticket.urgencyScore}
        </span>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-100 to-stone-200 ring-1 ring-stone-200">
        <Search className="h-5 w-5 text-stone-500" />
      </div>
      <p className="mt-4 text-sm font-semibold text-stone-900">
        No tickets match
      </p>
      <p className="mt-1 text-sm text-stone-500">
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
  const [showBreachedOnly, setShowBreachedOnly] = useState(false);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const queueRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const intakeRef = useRef<HTMLElement | null>(null);
  const teamRef = useRef<HTMLElement | null>(null);
  const setupRef = useRef<HTMLElement | null>(null);
  const manualTitleRef = useRef<HTMLInputElement | null>(null);
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
  const isLive = data.source === "database";
  const breachedTickets = data.tickets.filter((ticket) =>
    isBreachedTicket(ticket, nowMs),
  ).length;

  function scrollToSection(ref: RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFilters() {
    setQuery("");
    setPriorityFilter("all");
    setStatusFilter("active");
    setTeamFilter("all");
    setShowBreachedOnly(false);
  }

  function activateMetric(metricKey: OpsMetric["key"]) {
    if (metricKey === "openTickets") {
      resetFilters();
    }

    if (metricKey === "p1Incidents") {
      setQuery("");
      setPriorityFilter("P1");
      setStatusFilter("active");
      setTeamFilter("all");
      setShowBreachedOnly(false);
    }

    if (metricKey === "slaBreaches") {
      setQuery("");
      setPriorityFilter("all");
      setStatusFilter("active");
      setTeamFilter("all");
      setShowBreachedOnly(true);
    }

    if (metricKey === "avgAge") {
      setStatusFilter("active");
      setShowBreachedOnly(false);
    }

    scrollToSection(queueRef);
  }

  function focusManualIntake() {
    scrollToSection(intakeRef);
    window.setTimeout(() => manualTitleRef.current?.focus(), 300);
  }

  async function copyText(value: string, labelText: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = value;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setNotice(`${labelText} copied`);
    } catch {
      setNotice(`${labelText}: ${value}`);
    }
  }

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
      if (showBreachedOnly && !isBreachedTicket(ticket, nowMs)) return false;
      if (teamFilter !== "all" && ticket.assignedTeamId !== teamFilter) {
        return false;
      }
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

  function copyWebhookUrl() {
    void copyText(
      `${window.location.origin}/api/webhooks/inbound-email`,
      "Webhook URL",
    );
  }

  function copyWebhookExample() {
    const payload = {
      source: "monitor",
      id: "alert-123",
      from: "alerts@example.com",
      subject: "Checkout latency above threshold",
      body: "Customer-facing checkout latency is breaching SLA.",
      service: "checkout-api",
      severity: "critical",
    };

    void copyText(JSON.stringify(payload, null, 2), "Webhook example");
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
    <main className="min-h-screen overflow-x-hidden text-stone-900">
      <div className="grid min-h-screen lg:grid-cols-[80px_minmax(0,1fr)]">
        <aside className="sidebar-ink hidden text-white lg:flex lg:flex-col lg:items-center lg:justify-between lg:py-6">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-200 via-amber-100 to-stone-50 text-stone-900 shadow-lg ring-1 ring-black/10 transition hover:scale-105"
              aria-label="Scroll to overview"
              title="Overview"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#181614] ring-pulse" />
            </button>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => scrollToSection(queueRef)}
                className="group relative flex h-11 w-11 items-center justify-center rounded-xl bg-white text-stone-900 shadow-md ring-1 ring-white/40 transition hover:bg-amber-100"
                aria-label="Go to queue"
                title="Queue"
              >
                <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-amber-300" />
                <Inbox className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSection(detailRef)}
                className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Go to detail"
                title="Detail"
              >
                <Activity className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSection(setupRef)}
                className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Go to setup"
                title="Setup"
              >
                <Database className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSection(teamRef)}
                className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Go to teams"
                title="Teams"
              >
                <Users className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex h-2 w-2 items-center justify-center self-center rounded-full bg-emerald-400 ring-pulse" />
            <button
              type="button"
              onClick={() => {
                resetFilters();
                scrollToSection(queueRef);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[11px] font-semibold tracking-wide text-stone-200 transition hover:border-amber-300 hover:text-amber-200"
              aria-label="Reset filters"
              title="Reset filters"
            >
              K3
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="glass-header sticky top-0 z-20 border-b border-stone-200/70">
            <div className="mx-auto flex max-w-[1540px] flex-col gap-4 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:px-10">
              <div className="flex min-w-0 items-center gap-4">
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md ring-1 ring-black/10 lg:hidden"
                  aria-label="Scroll to overview"
                >
                  <Bell className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Alert Triage
                  </p>
                  <h1 className="truncate font-semibold tracking-tight text-stone-950 text-[22px] sm:text-[26px]">
                    Operations command center
                  </h1>
                </div>
              </div>
              <div className="grid w-[calc(100vw-2rem)] max-w-full grid-cols-1 gap-2 sm:flex sm:w-full sm:flex-wrap sm:items-center xl:w-auto">
                <button
                  type="button"
                  onClick={() => runMutation(checkHealth)}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3.5 text-[12.5px] font-semibold ${
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
                  {isLive ? "Neon live" : "Demo data"}
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection(setupRef)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3.5 text-[12.5px] font-semibold text-stone-700 backdrop-blur transition hover:bg-white"
                >
                  <Layers3 className="h-4 w-4 text-amber-600" />
                  Integrations pending
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runMutation(() => refresh().then(() => "Refreshed"))
                  }
                  disabled={isPending}
                  className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[12.5px] font-semibold disabled:opacity-60"
                >
                  <RotateCcw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
          </header>

          <section className="mx-auto max-w-[1540px] px-4 py-6 sm:px-6 xl:px-10">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {data.metrics.map((metric) => (
                <MetricCard
                  key={metric.key}
                  metric={
                    metric.key === "slaBreaches"
                      ? { ...metric, value: String(breachedTickets) }
                      : metric
                  }
                  active={
                    (metric.key === "openTickets" &&
                      statusFilter === "active" &&
                      priorityFilter === "all" &&
                      teamFilter === "all" &&
                      !showBreachedOnly &&
                      !query) ||
                    (metric.key === "p1Incidents" &&
                      priorityFilter === "P1" &&
                      !showBreachedOnly) ||
                    (metric.key === "slaBreaches" && showBreachedOnly)
                  }
                  onActivate={() => activateMetric(metric.key)}
                />
              ))}
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)_360px]">
              <section
                id="triage-queue"
                ref={queueRef}
                className="surface-card scroll-mt-24 overflow-hidden"
              >
                <div className="border-b border-stone-200/70 bg-gradient-to-b from-stone-50 to-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md ring-1 ring-black/10">
                        <Inbox className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                          Triage queue
                        </h2>
                        <p className="text-[12.5px] text-stone-500">
                          <span className="font-semibold text-stone-700 tabular-nums">
                            {activeTickets}
                          </span>{" "}
                          active ·{" "}
                          <span className="tabular-nums">{data.tickets.length}</span> total
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 shadow-sm">
                      {filteredTickets.length} shown
                    </span>
                  </div>
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search by title, owner, team…"
                      className="input-field h-10 w-full min-w-0 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400"
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
                        onClick={resetFilters}
                        className="btn-soft inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        Reset
                      </button>
                    </div>
                  </div>
                  {showBreachedOnly ? (
                    <button
                      type="button"
                      onClick={() => setShowBreachedOnly(false)}
                      className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700"
                    >
                      <XCircle className="h-4 w-4" />
                      SLA breaches only
                    </button>
                  ) : null}
                </div>
                <div className="fancy-scroll max-h-[calc(100vh-360px)] min-h-[360px] overflow-y-auto">
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

              <section
                id="ticket-detail"
                ref={detailRef}
                className="surface-card scroll-mt-24 overflow-hidden"
              >
                {selectedTicket ? (
                  <div>
                    <div className="hero-ink relative overflow-hidden border-b border-black/40 px-6 py-6 text-white">
                      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
                      <div className="pointer-events-none absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />
                      <div className="relative flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ${priorityClass[selectedTicket.priority]}`}
                            >
                              {priorityIcon(selectedTicket.priority)}
                              {selectedTicket.priority}
                            </span>
                            <span className="rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] tracking-wide text-stone-200 ring-1 ring-white/10">
                              TK-{selectedTicket.ticketNumber}
                            </span>
                            <span
                              className={`inline-flex h-7 items-center rounded-md bg-white/8 px-2 text-[11px] font-semibold capitalize text-stone-100 ring-1 ring-white/10 ${
                                selectedTicket.status === "in_progress"
                                  ? "text-amber-200"
                                  : ""
                              }`}
                            >
                              {label(selectedTicket.status)}
                            </span>
                          </div>
                          <h2 className="mt-4 max-w-3xl text-[26px] font-semibold leading-[1.2] tracking-tight">
                            {selectedTicket.title}
                          </h2>
                          <p className="mt-3 max-w-3xl text-[14px] leading-6 text-stone-300/90">
                            {selectedTicket.description || "No description yet."}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                            Last refresh
                          </p>
                          <p className="mt-1 text-[13px] font-semibold tabular-nums">
                            {formatDateTime(data.refreshedAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 border-b border-stone-200/70 bg-gradient-to-b from-stone-50 to-white p-5 md:grid-cols-4">
                      {[
                        ["Status", label(selectedTicket.status)],
                        ["Owner", selectedTicket.assignee],
                        ["Team", selectedTicket.team],
                        [
                          "Reporter",
                          selectedTicket.reporterEmail ?? "system alert",
                        ],
                      ].map(([title, value]) => (
                        <div
                          key={title}
                          className="rounded-xl border border-stone-200/70 bg-white p-3 shadow-sm"
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-400">
                            {title}
                          </p>
                          <p className="mt-1 truncate text-[13.5px] font-semibold capitalize text-stone-900">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="p-6">
                      <div className="grid gap-3 md:grid-cols-3">
                        <button
                          type="button"
                          disabled={isPending || !isLive}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "in_progress",
                                comment: "Acknowledged from the console.",
                              });
                              return "Acknowledged";
                            })
                          }
                          className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={isPending || !isLive}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "resolved",
                                comment: "Resolved from the console.",
                              });
                              return "Resolved";
                            })
                          }
                          className="btn-success inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Resolve
                        </button>
                        <button
                          type="button"
                          disabled={isPending || !isLive}
                          onClick={() =>
                            runMutation(async () => {
                              await patchTicket(selectedTicket.id, {
                                status: "triaged",
                                comment: "Reopened from the console.",
                              });
                              return "Reopened";
                            })
                          }
                          className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
                        >
                          <XCircle className="h-4 w-4" />
                          Reopen
                        </button>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <SelectField
                          labelText="Status"
                          value={selectedTicket.status}
                          disabled={isPending || !isLive}
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
                          disabled={isPending || !isLive}
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
                          disabled={isPending || !isLive}
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
                          disabled={isPending || !isLive}
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

                      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <form onSubmit={submitComment} className="space-y-3">
                          <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                            Comment
                            <textarea
                              value={comment}
                              onChange={(event) => setComment(event.target.value)}
                              rows={5}
                              placeholder="Add an update for the team…"
                              disabled={isPending || !isLive}
                              className="input-field w-full min-w-0 resize-none px-3 py-2.5 text-sm normal-case tracking-normal text-stone-900 placeholder:text-stone-400 disabled:bg-stone-50"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={
                              !comment.trim() || isPending || !isLive
                            }
                            className="btn-soft inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
                          >
                            <MessageSquarePlus className="h-4 w-4" />
                            Add comment
                          </button>
                        </form>

                        <div className="surface-inset p-4">
                          <p className="text-[13px] font-semibold tracking-tight text-stone-950">
                            Incident shape
                          </p>
                          <div className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-stone-500">Duplicates</span>
                              <span className="rounded-md bg-white px-2 py-0.5 font-semibold tabular-nums text-stone-900 ring-1 ring-stone-200">
                                {selectedTicket.duplicateCount}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-stone-500">Score</span>
                              <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-stone-900 ring-1 ring-stone-200">
                                {selectedTicket.importanceScore} ×{" "}
                                {selectedTicket.urgencyScore}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-stone-500">SLA</span>
                              <span className="font-semibold tabular-nums text-stone-900">
                                {selectedTicket.slaDueAt
                                  ? formatDateTime(selectedTicket.slaDueAt)
                                  : "Not set"}
                              </span>
                            </div>
                            {selectedIncident ? (
                              <div className="border-t border-stone-200 pt-3 text-[12.5px] leading-5 text-stone-600">
                                <span className="font-semibold text-stone-800">
                                  {selectedIncident.blastCount}
                                </span>{" "}
                                linked alerts · confidence{" "}
                                <span className="font-semibold text-stone-800">
                                  {selectedIncident.confidence ?? "n/a"}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-7 border-t border-stone-200/70 pt-5">
                        <div className="mb-4 flex items-center justify-between">
                          <h3 className="text-[15px] font-semibold tracking-tight text-stone-950">
                            Timeline
                          </h3>
                          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200/70">
                            {selectedTicket.comments.length} comments
                          </span>
                        </div>
                        <div className="space-y-5">
                          {selectedTicket.comments.length > 0 ? (
                            selectedTicket.comments.map((item, index) => (
                              <div key={item.id} className="relative grid gap-2 pl-6">
                                <span
                                  aria-hidden
                                  className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-stone-700 to-stone-900 ring-4 ring-stone-100"
                                />
                                {index < selectedTicket.comments.length - 1 ? (
                                  <span
                                    aria-hidden
                                    className="absolute left-[10px] top-4 h-[calc(100%+0.75rem)] w-px bg-stone-200"
                                  />
                                ) : null}
                                <p className="text-[14px] leading-6 text-stone-900">
                                  {item.body}
                                </p>
                                <p className="text-[11.5px] text-stone-500">
                                  <span className="font-medium text-stone-700">
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
                            <p className="text-sm text-stone-500">
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
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-lg ring-1 ring-black/10">
                        <Sparkles className="h-7 w-7" />
                      </div>
                      <p className="mt-4 text-[15px] font-semibold tracking-tight text-stone-950">
                        Select or create a ticket
                      </p>
                      <p className="mt-1 text-sm text-stone-500">
                        Choose one from the queue, or use manual intake.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <aside className="space-y-5">
                <section
                  id="manual-intake"
                  ref={intakeRef}
                  className="surface-card scroll-mt-24 p-5"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                        Manual intake
                      </h2>
                      <p className="text-[12.5px] text-stone-500">
                        Create a live ticket
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={focusManualIntake}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md ring-1 ring-black/10 transition hover:scale-105"
                      aria-label="Focus manual intake"
                      title="New ticket"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <form onSubmit={createManualTicket} className="space-y-3">
                    <TextField
                      labelText="Title"
                      inputRef={manualTitleRef}
                      value={draft.title}
                      onChange={(value) =>
                        setDraft((next) => ({ ...next, title: value }))
                      }
                      placeholder="Short incident title"
                    />
                    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
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
                        className="input-field w-full min-w-0 resize-none px-3 py-2.5 text-sm normal-case tracking-normal text-stone-900 placeholder:text-stone-400"
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
                      disabled={!draft.title.trim() || isPending || !isLive}
                      className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      Create ticket
                    </button>
                  </form>
                </section>

                <section
                  id="team-load"
                  ref={teamRef}
                  className="surface-card scroll-mt-24 p-5"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                      Team load
                    </h2>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-md ring-1 ring-black/10">
                      <Users className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    {data.teamLoad.map((team) => {
                      const width = Math.min(
                        100,
                        Math.max(12, team.openTickets * 18),
                      );
                      const tone =
                        width > 75
                          ? "from-red-500 to-red-700"
                          : width > 50
                            ? "from-amber-400 to-amber-600"
                            : "from-stone-700 to-stone-900";
                      const teamOption = data.teams.find(
                        (item) => item.name === team.team,
                      );
                      return (
                        <button
                          key={team.team}
                          type="button"
                          onClick={() => {
                            if (teamOption) {
                              setTeamFilter(teamOption.id);
                              setStatusFilter("active");
                              setPriorityFilter("all");
                              setShowBreachedOnly(false);
                              scrollToSection(queueRef);
                            }
                          }}
                          className="w-full rounded-xl p-2 text-left transition hover:bg-stone-50"
                        >
                          <div className="mb-2 flex items-center justify-between text-[13px]">
                            <span className="font-semibold tracking-tight text-stone-900">
                              {team.team}
                            </span>
                            <span className="text-stone-500 tabular-nums">
                              {team.openTickets} open
                            </span>
                          </div>
                          <div className="relative h-2 overflow-hidden rounded-full bg-stone-100 ring-1 ring-stone-200/60">
                            <div
                              className={`h-2 rounded-full bg-gradient-to-r ${tone} shadow-[0_0_12px_rgba(0,0,0,0.08)] transition-all duration-500`}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section
                  id="setup"
                  ref={setupRef}
                  className="scroll-mt-24 relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-amber-100/70 to-amber-50 p-5 text-amber-950 shadow-[0_8px_24px_-16px_rgba(180,83,9,0.4)]"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-300/40 blur-2xl" />
                  <div className="relative flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-md ring-1 ring-amber-600/20">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-[15px] font-semibold tracking-tight">
                        Final setup queue
                      </h2>
                      <p className="text-[12.5px] text-amber-800">
                        Provider webhooks & API keys
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <button
                      type="button"
                      onClick={copyWebhookUrl}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white shadow-sm"
                    >
                      <Send className="h-4 w-4" />
                      Copy webhook URL
                    </button>
                    <button
                      type="button"
                      onClick={copyWebhookExample}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-900 shadow-sm"
                    >
                      <Layers3 className="h-4 w-4" />
                      Copy test payload
                    </button>
                    <button
                      type="button"
                      onClick={() => runMutation(checkHealth)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-900 shadow-sm"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Check database
                    </button>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </div>
      </div>

      {notice ? (
        <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-stone-200 bg-white/95 px-4 py-3 text-sm font-semibold text-stone-800 shadow-[0_24px_48px_-24px_rgba(20,14,5,0.45)] backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-pulse" />
            {notice}
          </div>
        </div>
      ) : null}
    </main>
  );
}
