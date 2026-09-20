"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  Inbox,
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
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { HelpdeskShell } from "@/components/helpdesk-shell";
import { SyncroIntegrationCard } from "@/components/syncro-integration-card";
import type { ShellSection } from "@/components/helpdesk-shell";
import { useDialogFocus } from "@/components/use-dialog-focus";
import {
  CompleteTicketDialog,
  type CompletionEvidence,
} from "@/components/jev/complete-ticket-dialog";
import { CompletionReviewPanel } from "@/components/jev/completion-review-panel";
import { IntakeAssessmentCard } from "@/components/jev/intake-assessment-card";
import type {
  DashboardData,
  IncidentSnapshot,
  Priority,
  TicketQueueItem,
  TicketStatus,
  UserOption,
  UserRole,
} from "@/lib/types";

type FilterStatus = "all" | TicketStatus;
type TicketQueueMode = "active" | "archive";

type RepairShoprUiStatus = {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastStatus: "running" | "success" | "error" | "not_configured";
  lastError: string | null;
};

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
const activeStatuses = statuses.filter(
  (status) => status !== "resolved" && status !== "closed",
);
const archiveStatuses = statuses.filter(
  (status) => status === "resolved" || status === "closed",
);
const roles: UserRole[] = ["agent", "manager", "admin", "reporter"];

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
  if (status === "resolved") return "Resolved";
  if (status === "closed") return "Closed";
  if (status === "in_progress") return "Being worked";
  return "Needs attention";
}

function friendlyPriority(priority: Priority) {
  if (priority === "P1") return "High";
  if (priority === "P2") return "Medium";
  if (priority === "P3") return "Normal";
  return "Low";
}

function statusLabel(status: TicketStatus) {
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function priorityIcon(priority: Priority) {
  if (priority === "P1") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (priority === "P2") return <RadioTower className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
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
    ticket.customerName,
    ticket.priority,
    ticket.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function customerLabel(ticket: TicketQueueItem) {
  return ticket.customerName ?? ticket.reporterEmail ?? "System alert";
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
    <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
    <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
      {labelText}
      <input
        type={type}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field h-11 w-full rounded-lg px-3 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-24 lg:bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-[#d7ecdf] bg-white px-4 py-3 text-sm font-semibold text-ink shadow-lg">
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
      className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
    >
      <ShieldCheck className="h-4 w-4" />
      {isLive ? "Live data" : "Demo data"}
    </button>
  );
}

function useDashboardState(
  initialData: DashboardData,
  options: {
    ticketScope?: TicketQueueMode | "mixed";
    ticketId?: string;
    ticketLimit?: number;
  } = {},
) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function dashboardUrl(ticketOffset = 0) {
    const params = new URLSearchParams();
    if (options.ticketScope && options.ticketScope !== "mixed") {
      params.set("ticketScope", options.ticketScope);
    }
    if (options.ticketId) params.set("ticketId", options.ticketId);
    if (options.ticketLimit) {
      params.set("ticketLimit", String(options.ticketLimit));
    }
    if (ticketOffset > 0) params.set("ticketOffset", String(ticketOffset));
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return `/api/dashboard${query}`;
  }

  async function fetchDashboard(ticketOffset = 0) {
    const response = await fetch(dashboardUrl(ticketOffset), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to refresh dashboard");
    return (await response.json()) as DashboardData;
  }

  async function refresh() {
    const nextData = await fetchDashboard();
    setData(nextData);
    return nextData;
  }

  async function loadMoreTickets() {
    if (!data.ticketPage.hasMore) return "All tickets are loaded";
    const nextData = await fetchDashboard(data.tickets.length);
    setData((current) => {
      const knownIds = new Set(current.tickets.map((ticket) => ticket.id));
      const additionalTickets = nextData.tickets.filter(
        (ticket) => !knownIds.has(ticket.id),
      );
      return {
        ...nextData,
        tickets: [...current.tickets, ...additionalTickets],
        ticketPage: {
          ...nextData.ticketPage,
          offset: 0,
        },
      };
    });
    return `Loaded ${nextData.tickets.length} more tickets`;
  }

  function runMutation(action: () => Promise<string | void>) {
    setNotice(null);
    startTransition(async () => {
      try {
        const message = await action();
        if (message) setNotice(message);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Something went wrong",
        );
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
    router.push(`/tickets/${result.ticket.id}`);
    return result.ticket.ticket_number
      ? `Created TK-${result.ticket.ticket_number}`
      : "Request created";
  }

  async function patchTicket(
    ticketId: string,
    payload: Record<string, unknown>,
  ) {
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
    loadMoreTickets,
    checkHealth,
    createTicket,
    patchTicket,
    addComment,
  };
}

function TicketTask({
  ticket,
  nowMs,
}: {
  ticket: TicketQueueItem;
  nowMs: number;
}) {
  const isBreached = isBreachedTicket(ticket, nowMs);

  return (
    <Link href={`/tickets/${ticket.id}`} className="ticket-row group">
      <span
        aria-hidden="true"
        className={`ticket-rail priority-rail-${ticket.priority.toLowerCase()}`}
      />
      <div className="ticket-row-content">
        <div className="ticket-row-top">
          <span className="ticket-number">TK-{ticket.ticketNumber}</span>
          {ticket.createdFrom === "syncro" || ticket.createdFrom === "repairshopr" ? (
            <span className="text-xs text-ink-muted">{ticket.createdFrom === "syncro" ? "Syncro" : "RepairShopr"}</span>
          ) : null}
          <span
            className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium ${priorityClass[ticket.priority]}`}
          >
            {friendlyPriority(ticket.priority)}
          </span>
          <span
            className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium ${statusTone[ticket.status]}`}
          >
            {friendlyStatus(ticket.status)}
          </span>
          {isBreached ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-100">
              <Clock3 className="h-3 w-3" />
              Due now
            </span>
          ) : null}
        </div>
        <h3 className="line-clamp-2 text-ink">{ticket.title}</h3>
        <div className="ticket-row-meta">
          <span className="truncate">{customerLabel(ticket)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Users size={12} />
            {ticket.assignee}
          </span>
          <span
            className={
              isBreached ? "font-semibold text-red-700" : "font-semibold"
            }
          >
            {ticket.slaDueAt
              ? `Due ${formatDateTime(ticket.slaDueAt)}`
              : "No due time"}
          </span>
        </div>
      </div>
      <ArrowUpRight size={16} className="ticket-row-arrow" />
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
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMore = tickets.length > 6;
  const visibleTickets = isExpanded ? tickets : tickets.slice(0, 6);
  return (
    <section className="work-bucket">
      <div className="work-bucket-header">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-ink-muted">{helper}</p>
        </div>
        <span className="bucket-count">{tickets.length}</span>
      </div>
      {visibleTickets.length > 0 ? (
        <>
          <div className="grid gap-2">
            {visibleTickets.map((ticket) => (
              <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
            ))}
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setIsExpanded((expanded) => !expanded)}
              className="btn-soft mt-4 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold"
            >
              {isExpanded ? "Show less" : `Show all ${tickets.length}`}
            </button>
          ) : null}
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-lg bg-surface-muted px-4 py-5 text-xs text-ink-muted">
          <CheckCircle2 size={16} className="shrink-0 text-slate-400" />
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
  const dialogRef = useDialogFocus(isOpen, () => {
    setDraft(emptyDraft);
    onClose();
  });

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
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="new-request-title"
              className="text-lg font-semibold text-ink"
            >
              New request
            </h2>
            <p className="text-sm text-ink-muted">Add a task for the team.</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <TextField
            labelText="Title"
            inputRef={titleRef}
            value={draft.title}
            onChange={(value) =>
              setDraft((next) => ({ ...next, title: value }))
            }
            placeholder="What needs help?"
          />
          <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Notes
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((next) => ({
                  ...next,
                  description: event.target.value,
                }))
              }
              rows={4}
              placeholder="Add the important context."
              className="input-field w-full resize-none rounded-lg px-3 py-2.5 text-sm normal-case tracking-normal text-slate-900 placeholder:text-slate-400"
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
            className="btn-primary mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            Create request
          </button>
        </form>
      </div>
    </div>
  );
}

export function HomeConsole({ initialData }: { initialData: DashboardData }) {
  const {
    data,
    notice,
    isPending,
    runMutation,
    refresh,
    checkHealth,
    createTicket,
  } = useDashboardState(initialData, {
    ticketScope: "active",
    ticketLimit: 20,
  });
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);

  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const openTickets = data.tickets.filter(isActive);
  const urgentTickets =
    data.ticketHighlights?.urgent ??
    openTickets
      .filter((ticket) => ticket.priority === "P1" || ticket.priority === "P2")
      .slice(0, 4);
  const recentTickets =
    data.ticketHighlights?.recent.slice(0, 5) ??
    [...openTickets]
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      )
      .slice(0, 5);
  const staffedTeams = data.teams.filter((team) => team.onCall > 0).length;
  const repairShopr = data.integrations?.repairshopr;

  function submitNewTicket(draft: DraftTicket) {
    runMutation(async () => {
      await createTicket(draft);
    });
    setIsNewTicketOpen(false);
  }

  return (
    <HelpdeskShell
      active="home"
      title="Command center"
      subtitle="Home"
      actions={
        <>
          <HealthButton
            isLive={isLive}
            isPending={isPending}
            onClick={() => runMutation(checkHealth)}
          />
          <button
            type="button"
            onClick={() => setIsNewTicketOpen(true)}
            disabled={!canMutate}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New request
          </button>
        </>
      }
    >
      <section className="page-content grid gap-6">
        <section className="command-hero">
          <div>
            <div className="hero-eyebrow">
              <RadioTower className="h-3.5 w-3.5" />
              {isLive ? "Your service workspace" : "Demo workspace"}
            </div>
            <h2>
              Less noise.
              <br />
              More resolved.
            </h2>
            <p>
              A clear view of the work that matters. Triage incoming requests,
              keep your team moving, and close the loop with confidence.
            </p>
            <div className="hero-actions">
              <Link
                href="/tickets"
                className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
              >
                Go to ticket queue
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/settings" className="hero-secondary">
                <Settings className="h-4 w-4" />
                Configure intake
              </Link>
              <button
                type="button"
                onClick={() =>
                  runMutation(() => refresh().then(() => "Refreshed"))
                }
                disabled={isPending}
                className="hero-secondary disabled:opacity-60"
                aria-label="Refresh dashboard"
              >
                <RotateCcw
                  className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <div className="workflow-preview" aria-label="Service workflow">
            <div className="workflow-preview-label">
              Every request. A clear path.
            </div>
            <div className="workflow-stage">
              <span>01</span>
              <div>
                Triage & route<small>Jev classifies. Your rules assign.</small>
              </div>
            </div>
            <div className="workflow-stage">
              <span>02</span>
              <div>
                Resolve & document<small>Technicians take the lead.</small>
              </div>
            </div>
            <div className="workflow-stage">
              <span>03</span>
              <div>
                Review & improve<small>Evidence informs the next step.</small>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCount label="Open tickets" value={data.ticketCounts.active} />
          <SummaryCount
            label="High priority"
            value={data.ticketCounts.urgent}
          />
          <SummaryCount
            label="SLA overdue"
            value={data.ticketCounts.breached}
          />
          <SummaryCount label="Teams on call" value={staffedTeams} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <section className="rounded-xl border border-border bg-white/80 p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-tight text-ink">
                  Priority inbox
                </h2>
                <p className="mt-1 text-sm leading-5 text-ink-muted">
                  Open P1 and P2 work pulled out of the queue.
                </p>
              </div>
              <span className="rounded-full bg-background px-3 py-1 text-[12px] font-semibold tabular-nums text-ink ring-1 ring-border">
                {data.ticketCounts.urgent}
              </span>
            </div>
            {urgentTickets.length > 0 ? (
              <div className="grid gap-3">
                {urgentTickets.map((ticket) => (
                  <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-10 text-center text-sm font-medium text-ink-muted">
                No high-priority open work right now.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-blue-100">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  System status
                </h2>
                <p className="mt-1 text-sm leading-5 text-ink-muted">
                  {isLive
                    ? "Connected to your live workspace."
                    : "You’re exploring with demo data."}
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              <StatusRow
                label="Database"
                value={isLive ? "Connected" : "Demo mode"}
                good={isLive}
              />
              <StatusRow
                label="RepairShopr"
                value={
                  repairShopr?.connected
                    ? "Connected"
                    : repairShopr?.configured
                      ? "Needs sync"
                      : "Not set"
                }
                good={Boolean(repairShopr?.connected)}
              />
              <StatusRow
                label="Due now"
                value={`${data.ticketCounts.breached} active`}
                good={data.ticketCounts.breached === 0}
              />
              <StatusRow
                label="On-call coverage"
                value={`${staffedTeams}/${data.teams.length} teams`}
                good={staffedTeams === data.teams.length}
              />
            </div>
            <Link
              href="/overview"
              className="btn-soft mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Activity className="h-4 w-4" />
              View overview
            </Link>
          </section>
        </div>

        <section className="rounded-xl border border-border bg-white/80 p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-ink">
                Recent movement
              </h2>
              <p className="mt-1 text-sm leading-5 text-ink-muted">
                Latest open tickets by update time.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/archive"
                className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-muted ring-1 ring-border hover:bg-surface-muted"
              >
                Archive
              </Link>
              <Link
                href="/tickets"
                className="rounded-full bg-background px-3 py-1.5 text-[12px] font-semibold text-ink ring-1 ring-border hover:bg-white"
              >
                See all
              </Link>
            </div>
          </div>
          {recentTickets.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {recentTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="rounded-lg border border-border bg-white px-4 py-3 transition-colors hover:border-blue-200 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold ${priorityClass[ticket.priority]}`}
                    >
                      {priorityIcon(ticket.priority)}
                      {friendlyPriority(ticket.priority)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] font-semibold tracking-wide text-ink-muted">
                      TK-{ticket.ticketNumber}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-ink">
                    {ticket.title}
                  </p>
                  <p className="mt-1 truncate text-[12px] text-ink-muted">
                    {ticket.team} / {ticket.assignee}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-8 text-center text-sm font-medium text-ink-muted">
              No open tickets right now. Completed work is in the archive.
            </div>
          )}
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
    </HelpdeskShell>
  );
}

function StatusRow({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-3">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span
        className={`inline-flex min-w-0 items-center gap-2 break-all rounded bg-white px-2.5 py-1 text-[11px] font-medium ring-1 ${
          good ? "text-accent ring-blue-100" : "text-amber-700 ring-amber-100"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            good ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        {value}
      </span>
    </div>
  );
}

export function TriageConsole({
  initialData,
  active = "tickets",
  title = "Open tickets",
  subtitle = "Tickets",
  mode = "active",
}: {
  initialData: DashboardData;
  active?: Extract<ShellSection, "home" | "tickets" | "archive">;
  title?: string;
  subtitle?: string;
  mode?: TicketQueueMode;
}) {
  const {
    data,
    notice,
    isPending,
    runMutation,
    refresh,
    loadMoreTickets,
    createTicket,
  } = useDashboardState(initialData, {
    ticketScope: mode === "archive" ? "archive" : "active",
    ticketLimit: 100,
  });
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
  const activeTicketCount = data.ticketCounts.active;
  const archivedTicketCount = data.ticketCounts.archived;
  const isArchive = mode === "archive";
  const remainingTicketCount = Math.max(
    0,
    (isArchive ? archivedTicketCount : activeTicketCount) - data.tickets.length,
  );
  const baseTickets = isArchive ? doneTickets : activeTickets;
  const statusOptions = isArchive ? archiveStatuses : activeStatuses;
  const breachedTickets = activeTickets.filter((ticket) =>
    isBreachedTicket(ticket, nowMs),
  ).length;

  const filteredTickets = useMemo(() => {
    return baseTickets.filter((ticket) => {
      if (statusFilter !== "all") {
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
    baseTickets,
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

  const humanTriageTickets = filteredTickets.filter(
    (ticket) =>
      isActive(ticket) && Boolean(ticket.intakeAssessment?.needsHumanTriage),
  );
  const needsAttentionTickets = filteredTickets.filter((ticket) => {
    if (!isActive(ticket) || ticket.status === "waiting") return false;
    if (humanTriageTickets.some((item) => item.id === ticket.id)) return false;
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
    return (
      !humanTriageTickets.some((item) => item.id === ticket.id) &&
      !needsAttentionTickets.some((item) => item.id === ticket.id)
    );
  });
  const resolvedTickets = filteredTickets.filter(
    (ticket) => ticket.status === "resolved",
  );
  const closedTickets = filteredTickets.filter(
    (ticket) => ticket.status === "closed",
  );

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
      active={active}
      title={title}
      subtitle={subtitle}
      actions={
        <>
          {isArchive ? (
            <Link
              href="/tickets"
              className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold"
            >
              <Inbox className="h-4 w-4" />
              Open tickets
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setIsNewTicketOpen(true)}
              disabled={!canMutate}
              className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              New request
            </button>
          )}
          <button
            type="button"
            onClick={() => runMutation(() => refresh().then(() => "Refreshed"))}
            disabled={isPending}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            <RotateCcw
              className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </>
      }
    >
      <section className="page-content grid gap-6">
        <section className="queue-intro">
          <div>
            <div className="section-kicker">
              {isArchive
                ? "The record of your work"
                : "Triage. Assign. Resolve."}
            </div>
            <h2>
              {isArchive
                ? "Closed loops, complete history."
                : "Your next move starts here."}
            </h2>
            <p>
              {isArchive
                ? "Find completed requests, revisit the evidence, and reopen anything that needs another look."
                : "A focused queue, organized by what needs you. Start with human triage, then move through the work."}
            </p>
          </div>
        </section>
        <div className="grid grid-cols-3 gap-3">
          {isArchive ? (
            <>
              <SummaryCount
                label="Resolved"
                value={data.ticketCounts.resolved}
              />
              <SummaryCount label="Closed" value={data.ticketCounts.closed} />
              <SummaryCount label="Archived" value={archivedTicketCount} />
            </>
          ) : (
            <>
              <SummaryCount
                label="Needs attention"
                value={data.ticketCounts.needsAttention}
              />
              <SummaryCount label="Waiting" value={data.ticketCounts.waiting} />
              <SummaryCount label="Archived" value={archivedTicketCount} />
            </>
          )}
        </div>

        <section className="rounded-xl border border-border bg-white/75 p-4 shadow-sm sm:p-5">
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Search loaded requests
              </span>
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Customer, ticket number, owner, or title"
                  className="input-field h-11 w-full rounded-lg pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400"
                />
              </span>
            </label>
            <details className="rounded-lg border border-border bg-surface-muted px-3 py-2">
              <summary className="flex h-7 cursor-pointer list-none items-center justify-between gap-6 text-[13px] font-semibold text-ink">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-ink-muted" />
                  Filters
                </span>
                <span className="text-[12px] text-ink-muted">
                  {hasActiveFilters ? "On" : "Off"}
                </span>
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <SelectField
                  labelText="Status"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as FilterStatus)}
                >
                  <option value="all">All</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
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
                      {friendlyPriority(priority)}
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
                    className="btn-soft inline-flex h-11 w-full items-center justify-center rounded-full px-4 text-sm font-semibold"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isArchive ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setPriorityFilter("all");
                        setStatusFilter("resolved");
                        setTeamFilter("all");
                        setShowBreachedOnly(false);
                      }}
                      className="rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                    >
                      Resolved
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setPriorityFilter("all");
                        setStatusFilter("closed");
                        setTeamFilter("all");
                        setShowBreachedOnly(false);
                      }}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Closed
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setPriorityFilter("P1");
                        setStatusFilter("all");
                        setTeamFilter("all");
                        setShowBreachedOnly(false);
                      }}
                      className="rounded-full border border-red-100 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-700 transition-colors hover:bg-red-50"
                    >
                      High priority
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setPriorityFilter("all");
                        setStatusFilter("all");
                        setTeamFilter("all");
                        setShowBreachedOnly(true);
                      }}
                      className="rounded-full border border-amber-100 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-700 transition-colors duration-150 hover:bg-amber-50"
                    >
                      Due now ({breachedTickets})
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
          <p className="mt-3 text-[12px] font-medium text-ink-muted">
            {filteredTickets.length} shown from {baseTickets.length} loaded of{" "}
            {isArchive ? archivedTicketCount : activeTicketCount} total{" "}
            {isArchive ? "archived" : "open"} tickets.{" "}
            {isArchive
              ? `${activeTicketCount} still open.`
              : `${archivedTicketCount} in archive.`}
            {hasActiveFilters
              ? " Filters apply to loaded tickets; load more to extend the results."
              : ""}
          </p>
        </section>

        <div className="grid gap-5">
          {isArchive ? (
            <>
              <WorkBucket
                title="Resolved"
                helper="Completed requests that can still be reopened from the ticket detail page."
                tickets={resolvedTickets}
                nowMs={nowMs}
                emptyMessage="No resolved requests match the current filters."
              />
              <WorkBucket
                title="Closed"
                helper="Closed requests kept for audit and follow-up review."
                tickets={closedTickets}
                nowMs={nowMs}
                emptyMessage="No closed requests match the current filters."
              />
            </>
          ) : (
            <>
              <WorkBucket
                title="Needs human triage"
                helper="Jev marked these tickets as ambiguous, low-confidence, unavailable, or outside the configured team map."
                tickets={humanTriageTickets}
                nowMs={nowMs}
                emptyMessage="No tickets need a person to confirm the route."
              />
              <WorkBucket
                title="Needs attention"
                helper="Pick from here first. These are new, urgent, unrouted, or due now."
                tickets={needsAttentionTickets}
                nowMs={nowMs}
                emptyMessage="Nothing needs immediate attention."
              />
              <WorkBucket
                title="Next up"
                helper="Open requests that are ready for someone to continue."
                tickets={nextUpTickets}
                nowMs={nowMs}
                emptyMessage="No other open requests match the current filters."
              />
              <WorkBucket
                title="Waiting"
                helper="Requests paused while the team waits for a reply or outside action."
                tickets={waitingTickets}
                nowMs={nowMs}
                emptyMessage="Nothing is waiting right now."
              />
              <section className="rounded-xl border border-border bg-white/80 p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-tight text-ink">
                      Completed work moved out of the way
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-ink-muted">
                      Resolved and closed tickets leave this queue
                      automatically.
                    </p>
                  </div>
                  <Link
                    href="/archive"
                    className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    View archive ({archivedTicketCount})
                  </Link>
                </div>
              </section>
            </>
          )}
        </div>
        {data.ticketPage.hasMore ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => runMutation(loadMoreTickets)}
              disabled={isPending}
              className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-60"
            >
              <RotateCcw
                className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
              />
              Load more ({remainingTicketCount} remaining)
            </button>
          </div>
        ) : null}
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
    </HelpdeskShell>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span aria-hidden="true" className="metric-marker" />
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value.toLocaleString("en")}</p>
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
  } = useDashboardState(initialData, { ticketId });
  const [note, setNote] = useState("");
  const [isCompletionOpen, setIsCompletionOpen] = useState(false);
  const [completionStatus, setCompletionStatus] = useState<
    "resolved" | "closed"
  >("resolved");
  const ticket = data.tickets.find((item) => item.id === ticketId) ?? null;
  const incident = ticket?.incidentId
    ? (data.incidents.find((item) => item.id === ticket.incidentId) ?? null)
    : null;
  const isLive = data.source === "database";
  const canMutate = isLive || (data.source === "demo" && !data.dbError);
  const sourceProvider = ticket?.createdFrom === "syncro" ? "Syncro" : "RepairShopr";
  const isMirroredTicket = ticket?.createdFrom === "repairshopr" || ticket?.createdFrom === "syncro";
  const sourceUrl = ticket?.syncroUrl ?? ticket?.repairshoprUrl;
  const sourceStatus = ticket?.syncroStatus ?? ticket?.repairshoprStatus;
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

  function completeTicket(evidence: CompletionEvidence) {
    if (!ticket) return;
    runMutation(async () => {
      await patchTicket(ticket.id, {
        status: completionStatus,
        comment: `${completionStatus === "closed" ? "Closed" : "Resolved"} from the helpdesk.`,
        ...evidence,
      });
      setIsCompletionOpen(false);
      return "Marked done and sent to Jev for review";
    });
  }

  function requestCompletion(status: "resolved" | "closed") {
    setCompletionStatus(status);
    setIsCompletionOpen(true);
  }

  return (
    <HelpdeskShell
      active="tickets"
      title={ticket ? "Help this customer" : "Ticket not found"}
      subtitle={ticket ? `TK-${ticket.ticketNumber}` : "Tickets"}
      actions={
        <>
          <HealthButton
            isLive={isLive}
            isPending={isPending}
            onClick={() => runMutation(checkHealth)}
          />
          <button
            type="button"
            onClick={() => runMutation(() => refresh().then(() => "Refreshed"))}
            disabled={isPending}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            <RotateCcw
              className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </>
      }
    >
      <section className="page-content">
        {ticket ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityClass[ticket.priority]}`}
                >
                  {friendlyPriority(ticket.priority)}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone[ticket.status]}`}
                >
                  {friendlyStatus(ticket.status)}
                </span>
                <span className="rounded-full bg-background px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-muted ring-1 ring-border">
                  TK-{ticket.ticketNumber}
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {ticket.title}
              </h2>
              <div className="mt-4 grid gap-3 text-sm text-ink-muted sm:grid-cols-2">
                <InfoLine label="Customer" value={customerLabel(ticket)} />
                <InfoLine label="Owner" value={ticket.assignee} />
                <InfoLine label="Team" value={ticket.team} />
                <InfoLine
                  label="Due"
                  value={
                    ticket.slaDueAt
                      ? formatDateTime(ticket.slaDueAt)
                      : "No due time"
                  }
                />
                {sourceStatus ? (
                  <InfoLine
                    label={sourceProvider}
                    value={sourceStatus}
                  />
                ) : null}
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {isMirroredTicket ? (
                  <div className="rounded-lg bg-surface-muted px-4 py-3 text-sm font-medium leading-6 text-ink-muted ring-1 ring-border sm:col-span-3">
                    {sourceProvider} owns this ticket status. Update it there so the
                    next sync does not replace a local-only change.
                  </div>
                ) : (
                  <>
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
                      <CheckCircle2 className="h-4 w-4" />I am on it
                    </ActionButton>
                    <button
                      type="button"
                      disabled={isPending || !canMutate}
                      onClick={() => requestCompletion("resolved")}
                      className="btn-success inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
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
                  </>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-ink">Details</h3>
              <div className="mt-4 grid gap-3">
                {sourceUrl ? (
                  <Link
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
                  >
                    <Settings className="h-4 w-4" />
                    Open in {sourceProvider}
                  </Link>
                ) : null}
                <SelectField
                  labelText={
                    isMirroredTicket ? `Status (${sourceProvider})` : "Status"
                  }
                  value={ticket.status}
                  disabled={isPending || !canMutate || isMirroredTicket}
                  onChange={(value) => {
                    if (
                      isActive(ticket) &&
                      (value === "resolved" || value === "closed")
                    ) {
                      requestCompletion(value);
                      return;
                    }
                    runMutation(async () => {
                      await patchTicket(ticket.id, {
                        status: value,
                        comment: `Status changed to ${label(value)}.`,
                      });
                      return "Status updated";
                    });
                  }}
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
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
                      {friendlyPriority(priority)}
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
            </section>

            {ticket.intakeAssessment && ticket.routingDecision ? (
              <IntakeAssessmentCard
                className="lg:col-span-2"
                assessment={{
                  status:
                    ticket.intakeAssessment.status === "succeeded"
                      ? ticket.intakeAssessment.needsHumanTriage
                        ? "human_review"
                        : "complete"
                      : ticket.intakeAssessment.status === "not_configured"
                        ? "unavailable"
                        : ticket.intakeAssessment.status === "failed"
                          ? "error"
                          : "pending",
                  issueType: ticket.intakeAssessment.issueType,
                  urgency: ticket.intakeAssessment.urgency,
                  suggestedTeam: ticket.intakeAssessment.suggestedTeam,
                  confidence: ticket.intakeAssessment.confidence,
                  model: ticket.intakeAssessment.model,
                  assessedAt: ticket.intakeAssessment.assessedAt,
                }}
                routing={{
                  assignedQueue: ticket.routingDecision.assignedTeam,
                  priority: ticket.routingDecision.priority,
                  responseDeadline: ticket.routingDecision.responseDueAt
                    ? formatDateTime(ticket.routingDecision.responseDueAt)
                    : null,
                  needsHumanTriage: ticket.routingDecision.needsHumanTriage,
                  routingReason: ticket.routingDecision.needsHumanTriage
                    ? "The assessment was ambiguous, unavailable, or below the routing confidence threshold."
                    : `${ticket.routingDecision.ruleVersion} applied the queue, priority, and deadline.`,
                }}
              />
            ) : null}
            {ticket.intakeAssessment?.needsHumanTriage ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                Human triage
              </span>
            ) : null}
            {ticket.completionReview?.status === "succeeded" ? (
              <span
                className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold ring-1 ${
                  ticket.completionReview.missingEvidenceCount > 0
                    ? "bg-amber-50 text-amber-800 ring-amber-200"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                }`}
              >
                {ticket.completionReview.missingEvidenceCount > 0
                  ? "Missing evidence"
                  : "Jev reviewed"}
              </span>
            ) : ticket.completionReview?.status === "failed" ||
              ticket.completionReview?.status === "not_configured" ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Review unavailable
              </span>
            ) : !isActive(ticket) ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">
                Review pending
              </span>
            ) : null}

            <section className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
              <h3 className="text-lg font-semibold text-ink">Request</h3>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-ink-muted">
                {ticket.description || "No notes were included yet."}
              </p>
            </section>

            {ticket.completionReview || !isActive(ticket) ? (
              <CompletionReviewPanel
                className="lg:col-span-2"
                reviewStatus={
                  ticket.completionReview?.status === "succeeded"
                    ? "complete"
                    : ticket.completionReview?.status === "failed"
                      ? "error"
                      : ticket.completionReview?.status === "not_configured"
                        ? "unavailable"
                        : "pending"
                }
                reviewedAt={
                  ticket.completionReview?.reviewedAt
                    ? formatDateTime(ticket.completionReview.reviewedAt)
                    : null
                }
                model={ticket.completionReview?.model}
                criteria={(ticket.completionReview?.criteria ?? []).map(
                  (criterion) => ({
                    id: criterion.id,
                    label: criterion.label,
                    status: criterion.outcome,
                    score: criterion.score,
                    maxScore: 3,
                  }),
                )}
              />
            ) : null}

            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-ink">Notes</h3>
              <form onSubmit={submitNote} className="mt-4 grid gap-3">
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={5}
                  placeholder="Add a helpful update..."
                  disabled={isPending || !canMutate}
                  className="input-field w-full resize-none rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50"
                />
                <button
                  type="submit"
                  disabled={!note.trim() || isPending || !canMutate}
                  className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  Add note
                </button>
              </form>
            </section>

            <IncidentContext ticket={ticket} incident={incident} />
            <Timeline ticket={ticket} />
          </div>
        ) : (
          <div className="grid min-h-[520px] place-items-center rounded-xl border border-border bg-white p-8 text-center shadow-sm">
            <div>
              <Sparkles className="mx-auto h-10 w-10 text-accent" />
              <p className="mt-4 text-lg font-semibold text-ink">
                Ticket not found
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                It may have been closed or removed from the current dashboard.
              </p>
              <Link
                href="/"
                className="btn-primary mt-5 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold"
              >
                Back home
              </Link>
            </div>
          </div>
        )}
      </section>
      {isCompletionOpen ? (
        <CompleteTicketDialog
          open
          ticketTitle={ticket?.title ?? "ticket"}
          completionStatus={completionStatus}
          pending={isPending}
          onCancel={() => setIsCompletionOpen(false)}
          onSubmit={completeTicket}
        />
      ) : null}
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
      className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-4 py-3 ring-1 ring-border">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-ink">{value}</p>
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
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-ink">Incident context</h3>
      <div className="mt-4 grid gap-3 text-sm">
        <InfoLine label="Duplicates" value={String(ticket.duplicateCount)} />
        <InfoLine
          label="Score"
          value={`${ticket.importanceScore} x ${ticket.urgencyScore}`}
        />
        <InfoLine label="Source" value={ticket.createdFrom} />
        {incident ? (
          <p className="rounded-lg bg-surface-muted p-4 leading-6 text-ink-muted ring-1 ring-border">
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
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">Activity</h3>
        <span className="rounded-full bg-background px-3 py-1 text-[12px] font-semibold text-ink-muted ring-1 ring-border">
          {ticket.comments.length} notes
        </span>
      </div>
      <div className="mt-5 grid gap-4">
        {ticket.comments.length > 0 ? (
          ticket.comments.map((item) => (
            <div
              key={item.id}
              className="rounded-lg bg-surface-muted p-4 ring-1 ring-border"
            >
              <p className="text-[14px] leading-6 text-ink">{item.body}</p>
              <p className="mt-2 text-[12px] font-medium text-ink-muted">
                {item.authorEmail ?? "system"} /{" "}
                {formatDateTime(item.createdAt)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-ink-muted">No notes yet.</p>
        )}
      </div>
    </section>
  );
}

export function OverviewConsole({
  initialData,
}: {
  initialData: DashboardData;
}) {
  const { data, notice, isPending, runMutation, refresh, checkHealth } =
    useDashboardState(initialData, { ticketScope: "active", ticketLimit: 50 });
  const nowMs = new Date(data.refreshedAt).getTime();
  const isLive = data.source === "database";
  const activeTickets = data.tickets.filter(isActive);
  const recentActiveTickets =
    data.ticketHighlights?.recent ??
    [...activeTickets].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
  const breachedTickets =
    data.ticketHighlights?.breached ??
    data.tickets.filter((ticket) => isBreachedTicket(ticket, nowMs));

  return (
    <HelpdeskShell
      active="overview"
      title="Team overview"
      subtitle="Overview"
      actions={
        <>
          <HealthButton
            isLive={isLive}
            isPending={isPending}
            onClick={() => runMutation(checkHealth)}
          />
          <button
            type="button"
            onClick={() => runMutation(() => refresh().then(() => "Refreshed"))}
            disabled={isPending}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            <RotateCcw
              className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </>
      }
    >
      <section className="page-content grid gap-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCount
            label="Open requests"
            value={data.ticketCounts.active}
          />
          <SummaryCount
            label="Need attention"
            value={data.ticketCounts.needsAttention}
          />
          <SummaryCount label="Waiting" value={data.ticketCounts.waiting} />
          <SummaryCount label="Done" value={data.ticketCounts.archived} />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Workload by team</h2>
            <div className="mt-4 grid gap-3">
              {data.teamLoad.map((team) => (
                <div
                  key={team.team}
                  className="rounded-lg bg-surface-muted p-4 ring-1 ring-border"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink">{team.team}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink-muted">
                      {team.openTickets} open
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${Math.min(100, team.openTickets * 16)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[12px] text-ink-muted">
                    {team.urgentTickets} urgent, {team.members} members
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Due now</h2>
            <div className="mt-4 grid gap-3">
              {breachedTickets.length > 0 ? (
                breachedTickets
                  .slice(0, 5)
                  .map((ticket) => (
                    <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
                  ))
              ) : (
                <p className="rounded-lg bg-surface-muted p-4 text-sm text-ink-muted ring-1 ring-border">
                  Nothing is overdue.
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-ink">
              Recent open activity
            </h2>
            <Link
              href="/archive"
              className="rounded-full bg-background px-3 py-1.5 text-[12px] font-semibold text-ink ring-1 ring-border hover:bg-white"
            >
              View archive
            </Link>
          </div>
          {activeTickets.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {recentActiveTickets.slice(0, 8).map((ticket) => (
                <TicketTask key={ticket.id} ticket={ticket} nowMs={nowMs} />
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-surface-muted p-4 text-sm text-ink-muted ring-1 ring-border">
              No open activity right now. Completed work is in the archive.
            </p>
          )}
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

export function SettingsConsole({
  initialData,
}: {
  initialData: DashboardData;
}) {
  const initialRepairShopr = initialData.integrations?.repairshopr;
  const jevStatus = initialData.integrations?.jev;
  const [integrationTest, setIntegrationTest] = useState({
    webhookUrl: "",
    apiKey: "",
    subject: "Integration smoke alert",
  });
  const [repairShoprStatus, setRepairShoprStatus] =
    useState<RepairShoprUiStatus>({
      configured: initialRepairShopr?.configured ?? false,
      connected: initialRepairShopr?.connected ?? false,
      lastSyncAt: initialRepairShopr?.lastSyncAt ?? null,
      lastStatus: initialRepairShopr?.lastStatus ?? "not_configured",
      lastError: null,
    });
  const [repairShoprConfig, setRepairShoprConfig] = useState<{
    subdomain: string | null;
    apiKeyPresent: boolean | null;
    syncSecretPresent: boolean | null;
    cronSecretPresent: boolean | null;
  }>({
    subdomain: null,
    apiKeyPresent: null,
    syncSecretPresent: null,
    cronSecretPresent: null,
  });
  const [repairShoprSyncSecret, setRepairShoprSyncSecret] = useState("");
  const [directoryData, setDirectoryData] = useState(initialData);
  const [teamDraft, setTeamDraft] = useState({ name: "" });
  const [userDraft, setUserDraft] = useState({
    email: "",
    fullName: "",
    role: "agent" as UserRole,
    teamId: initialData.teams[0]?.id ?? "",
    isOnCall: true,
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
        setNotice(
          error instanceof Error ? error.message : "Something went wrong",
        );
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

  async function refreshRepairShoprStatus() {
    const response = await fetch("/api/integrations/repairshopr/status", {
      cache: "no-store",
      headers: {
        "x-repairshopr-sync-secret": repairShoprSyncSecret,
      },
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      config?: {
        subdomain?: string | null;
        apiKeyPresent?: boolean;
        syncSecretPresent?: boolean;
        cronSecretPresent?: boolean;
        baseUrl?: string | null;
      };
      status?: RepairShoprUiStatus;
    };
    if (!response.ok || !result.ok || !result.status) {
      throw new Error(result.error ?? "Unable to refresh RepairShopr status");
    }
    setRepairShoprStatus(result.status);
    setRepairShoprConfig({
      subdomain: result.config?.subdomain ?? null,
      apiKeyPresent: Boolean(result.config?.apiKeyPresent),
      syncSecretPresent: Boolean(result.config?.syncSecretPresent),
      cronSecretPresent: Boolean(result.config?.cronSecretPresent),
    });
    return result.status.connected
      ? "RepairShopr connected"
      : "RepairShopr status refreshed";
  }

  async function testRepairShoprConnection() {
    const response = await fetch("/api/integrations/repairshopr/test", {
      method: "POST",
      headers: {
        "x-repairshopr-sync-secret": repairShoprSyncSecret,
      },
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "RepairShopr connection failed");
    }
    await refreshRepairShoprStatus();
    return "RepairShopr API connection works";
  }

  async function syncRepairShoprNow() {
    const response = await fetch("/api/integrations/repairshopr/sync", {
      method: "POST",
      headers: {
        "x-repairshopr-sync-secret": repairShoprSyncSecret,
      },
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      customersSynced?: number;
      ticketsSynced?: number;
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "RepairShopr sync failed");
    }
    await refreshRepairShoprStatus();
    await refreshDirectory();
    return `Synced ${result.customersSynced ?? 0} customers and ${
      result.ticketsSynced ?? 0
    } tickets`;
  }

  async function refreshDirectory() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to refresh people");
    const result = (await response.json()) as DashboardData;
    setDirectoryData(result);
    setUserDraft((next) => ({
      ...next,
      teamId: next.teamId || result.teams[0]?.id || "",
    }));
  }

  async function createTeamFromDraft() {
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teamDraft),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Unable to create team");
    }
    setTeamDraft({ name: "" });
    await refreshDirectory();
    return "Team saved";
  }

  async function createUserFromDraft() {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userDraft),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Unable to create user");
    }
    setUserDraft((next) => ({ ...next, email: "", fullName: "" }));
    await refreshDirectory();
    return "User saved";
  }

  function submitIntegrationTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(testIntegration);
  }

  function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(createTeamFromDraft);
  }

  function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(createUserFromDraft);
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
        <button
          type="button"
          onClick={() => runMutation(checkHealth)}
          disabled={isPending}
          className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
        >
          <ShieldCheck className="h-4 w-4" />
          Check setup
        </button>
      }
    >
      <section className="page-content grid gap-6">
        <SetupCard
          icon={<Database className="h-5 w-5" />}
          title="Receive requests by email"
          helper="Send inbound email events to this webhook so alerts become tickets."
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <code className="rounded-lg bg-surface-muted px-3 py-3 font-mono text-[12px] text-ink ring-1 ring-border">
              POST /api/webhooks/inbound-email
            </code>
            <button
              type="button"
              onClick={copyWebhookUrl}
              className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Send className="h-4 w-4" />
              Copy URL
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            Use your inbound webhook secret or Resend webhook secret in Vercel
            environment variables before sending live mail.
          </p>
        </SetupCard>

        <SetupCard
          icon={<Sparkles className="h-5 w-5" />}
          title="Jev assessments"
          helper="Use Jev once for incoming classification and again when a technician completes the ticket."
        >
          <div className="grid gap-3 xl:grid-cols-2">
            <StatusRow
              label="Connection"
              value={jevStatus?.configured ? "Configured" : "Key missing"}
              good={Boolean(jevStatus?.configured)}
            />
            <StatusRow
              label="Model"
              value={jevStatus?.model ?? "typesafe-ai/jev"}
              good={Boolean(jevStatus?.configured)}
            />
            <StatusRow
              label="Intake rubric"
              value={jevStatus?.triageRubricVersion ?? "ticket-triage-v1"}
              good
            />
            <StatusRow
              label="Review rubric"
              value={
                jevStatus?.completionRubricVersion ??
                "ticket-completion-review-v1"
              }
              good
            />
            <StatusRow
              label="Procedures"
              value={
                jevStatus?.procedureVersion ?? "company-ticket-completion-v1"
              }
              good={Boolean(jevStatus?.customProceduresConfigured)}
            />
          </div>
          <p className="mt-3 text-pretty text-sm leading-6 text-ink-muted">
            Store{" "}
            <code className="font-mono text-[12px] text-ink">
              AI_GATEWAY_API_KEY
            </code>{" "}
            on the server, or use Vercel OIDC, to route Jev through AI Gateway. Low-confidence intake stays in human triage. Missing
            completion evidence is excluded from quality scores and shown as a
            separate follow-up count. Common secrets and personal identifiers
            are redacted before ticket text is sent to Jev.
          </p>
        </SetupCard>

        <SyncroIntegrationCard />

        <SetupCard
          icon={<Settings className="h-5 w-5" />}
          title="RepairShopr mirror"
          helper="Pull tickets and customers from RepairShopr into this triage console."
        >
          <div className="grid gap-3 xl:grid-cols-2">
            <StatusRow
              label="Connection"
              value={
                repairShoprStatus.connected
                  ? "Connected"
                  : repairShoprStatus.configured
                    ? "Configured"
                    : "Not set"
              }
              good={repairShoprStatus.connected}
            />
            <StatusRow
              label="API key"
              value={
                repairShoprConfig.apiKeyPresent === null
                  ? "Not checked"
                  : repairShoprConfig.apiKeyPresent
                    ? "Stored"
                    : "Missing"
              }
              good={repairShoprConfig.apiKeyPresent === true}
            />
            <StatusRow
              label="Sync secret"
              value={
                repairShoprConfig.syncSecretPresent === null
                  ? "Not checked"
                  : repairShoprConfig.syncSecretPresent
                    ? "Stored"
                    : "Missing"
              }
              good={repairShoprConfig.syncSecretPresent === true}
            />
            <StatusRow
              label="Cron secret"
              value={
                repairShoprConfig.cronSecretPresent === null
                  ? "Not checked"
                  : repairShoprConfig.cronSecretPresent
                    ? "Stored"
                    : "Missing"
              }
              good={repairShoprConfig.cronSecretPresent === true}
            />
          </div>
          <div className="mt-3 rounded-lg bg-surface-muted px-3 py-3 text-sm leading-6 text-ink-muted ring-1 ring-border">
            <p>
              Subdomain:{" "}
              <span className="font-semibold text-ink">
                {repairShoprConfig.subdomain ??
                  "Enter the sync secret and refresh to check"}
              </span>
            </p>
            <p>
              Last sync:{" "}
              <span className="font-semibold text-ink">
                {repairShoprStatus.lastSyncAt
                  ? formatDateTime(repairShoprStatus.lastSyncAt)
                  : "Never"}
              </span>
            </p>
            {repairShoprStatus.lastError ? (
              <p className="font-semibold text-red-700">
                {repairShoprStatus.lastError}
              </p>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <TextField
              labelText="Sync secret"
              type="password"
              value={repairShoprSyncSecret}
              onChange={setRepairShoprSyncSecret}
              placeholder="For manual sync"
            />
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => runMutation(refreshRepairShoprStatus)}
                disabled={isPending || !repairShoprSyncSecret.trim()}
                className="btn-soft inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
              >
                <RotateCcw
                  className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => runMutation(testRepairShoprConnection)}
                disabled={
                  isPending ||
                  !repairShoprStatus.configured ||
                  !repairShoprSyncSecret.trim()
                }
                className="btn-soft inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                Test
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => runMutation(syncRepairShoprNow)}
                disabled={isPending || !repairShoprSyncSecret.trim()}
                className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
              >
                <RadioTower className="h-4 w-4" />
                Sync now
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            Set REPAIRSHOPR_SUBDOMAIN, REPAIRSHOPR_API_KEY,
            REPAIRSHOPR_SYNC_SECRET, and CRON_SECRET in Vercel. The five-minute
            cron schedule requires a Vercel Pro plan; manual sync uses the sync
            secret without storing it in the browser.
          </p>
        </SetupCard>

        <SetupCard
          icon={<RadioTower className="h-5 w-5" />}
          title="Send a test request"
          helper="Post a synthetic alert with an optional webhook secret or API key."
        >
          <form
            onSubmit={submitIntegrationTest}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <TextField
                labelText="Webhook URL"
                value={integrationTest.webhookUrl}
                onChange={(value) =>
                  setIntegrationTest((next) => ({ ...next, webhookUrl: value }))
                }
                placeholder="/api/webhooks/inbound-email"
              />
            </div>
            <TextField
              labelText="Webhook secret or API key"
              type="password"
              value={integrationTest.apiKey}
              onChange={(value) =>
                setIntegrationTest((next) => ({ ...next, apiKey: value }))
              }
              placeholder="Optional"
            />
            <TextField
              labelText="Subject"
              value={integrationTest.subject}
              onChange={(value) =>
                setIntegrationTest((next) => ({ ...next, subject: value }))
              }
              placeholder="Integration smoke alert"
            />
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60 sm:col-span-2"
            >
              <Send className="h-4 w-4" />
              Send test request
            </button>
          </form>
        </SetupCard>

        <SetupCard
          icon={<Users className="h-5 w-5" />}
          title="Teams and people"
          helper="Route alerts to the right team and on-call owner."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid gap-3">
              <form onSubmit={submitTeam} className="grid gap-3">
                <TextField
                  labelText="Team name"
                  value={teamDraft.name}
                  onChange={(value) => setTeamDraft({ name: value })}
                  placeholder="Billing"
                />
                <button
                  type="submit"
                  disabled={isPending || !teamDraft.name.trim()}
                  className="btn-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4" />
                  Add team
                </button>
              </form>
              <div className="grid gap-2">
                {directoryData.teams.map((team) => (
                  <div
                    key={team.id}
                    className="rounded-lg border border-border bg-surface-muted px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">
                        {team.name}
                      </p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-border">
                        {team.onCall}/{team.members} on call
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={submitUser} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  labelText="Email"
                  type="email"
                  value={userDraft.email}
                  onChange={(value) =>
                    setUserDraft((next) => ({ ...next, email: value }))
                  }
                  placeholder="teammate@decent4.com"
                />
                <TextField
                  labelText="Name"
                  value={userDraft.fullName}
                  onChange={(value) =>
                    setUserDraft((next) => ({ ...next, fullName: value }))
                  }
                  placeholder="Teammate name"
                />
                <SelectField
                  labelText="Role"
                  value={userDraft.role}
                  onChange={(value) =>
                    setUserDraft((next) => ({
                      ...next,
                      role: value as UserRole,
                    }))
                  }
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {label(role)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  labelText="Team"
                  value={userDraft.teamId}
                  onChange={(value) =>
                    setUserDraft((next) => ({ ...next, teamId: value }))
                  }
                >
                  <option value="">No team</option>
                  {directoryData.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </SelectField>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={userDraft.isOnCall}
                  onChange={(event) =>
                    setUserDraft((next) => ({
                      ...next,
                      isOnCall: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-blue-600"
                />
                On call
              </label>
              <button
                type="submit"
                disabled={isPending || !userDraft.email.trim()}
                className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" />
                Add user
              </button>
              <div className="grid gap-2">
                {directoryData.users.map((user) => {
                  const teamNames = user.teamIds
                    .map(
                      (teamId) =>
                        directoryData.teams.find((team) => team.id === teamId)
                          ?.name,
                    )
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <div
                      key={user.id}
                      className="rounded-lg border border-border bg-white px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {user.fullName ?? user.email}
                          </p>
                          <p className="mt-0.5 text-[12px] font-medium text-ink-muted">
                            {user.email}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-border">
                            {label(user.role)}
                          </span>
                          {user.onCall ? (
                            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent ring-1 ring-blue-100">
                              On call
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-ink-muted">
                        {teamNames || "No team"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </form>
          </div>
        </SetupCard>

        <SetupCard
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Example messages"
          helper="Use a sample payload when checking a provider sandbox."
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField
              labelText="Provider"
              value={exampleId}
              onChange={setExampleId}
            >
              {exampleProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </SelectField>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    JSON.stringify(example.payload, null, 2),
                    `${example.label} payload`,
                  )
                }
                className="btn-soft inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold"
              >
                <Send className="h-4 w-4" />
                Copy payload
              </button>
            </div>
          </div>
          <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-surface-muted px-3 py-3 font-mono text-[12px] leading-5 text-ink ring-1 ring-border">
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
    <article className="setup-card">
      <div className="setup-card-heading">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-blue-100">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-ink-muted">{helper}</p>
        </div>
      </div>
      <div className="setup-card-body">{children}</div>
    </article>
  );
}
