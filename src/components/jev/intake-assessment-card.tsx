import {
  ArrowRight,
  Bot,
  CircleAlert,
  CircleDashed,
  Route,
  ShieldCheck,
} from "lucide-react";

export type JevIntakeStatus =
  | "complete"
  | "human_review"
  | "pending"
  | "unavailable"
  | "error";

export type JevIntakeAssessment = {
  status: JevIntakeStatus;
  issueType?: string | null;
  urgency?: string | null;
  suggestedTeam?: string | null;
  confidence?: number | null;
  model?: string | null;
  assessedAt?: string | null;
  explanation?: string | null;
};

export type TicketRoutingDecision = {
  assignedQueue?: string | null;
  priority?: string | null;
  responseDeadline?: string | null;
  needsHumanTriage: boolean;
  routingReason?: string | null;
};

export type IntakeAssessmentCardProps = {
  assessment: JevIntakeAssessment;
  routing: TicketRoutingDecision;
  className?: string;
};

const statusPresentation: Record<
  JevIntakeStatus,
  { label: string; className: string }
> = {
  complete: {
    label: "Assessment complete",
    className: "bg-accent-soft text-accent ring-blue-100",
  },
  human_review: {
    label: "Needs human triage",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  pending: {
    label: "Assessment pending",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  unavailable: {
    label: "Jev unavailable",
    className: "bg-slate-100 text-slate-700 ring-slate-200",
  },
  error: {
    label: "Assessment failed",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
  },
};

function labelize(value?: string | null) {
  if (!value) return "Not reported";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function confidenceLabel(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "Not reported";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(100, Math.round(normalized)))}%`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-3 ring-1 ring-border">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

export function IntakeAssessmentCard({
  assessment,
  routing,
  className = "",
}: IntakeAssessmentCardProps) {
  const status = statusPresentation[assessment.status];

  return (
    <section
      aria-labelledby="jev-intake-assessment-title"
      className={`rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-accent">
            <Bot aria-hidden="true" className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">
              Incoming ticket
            </span>
          </div>
          <h2
            id="jev-intake-assessment-title"
            className="mt-2 text-balance text-xl font-semibold tracking-tight text-ink"
          >
            Jev intake assessment
          </h2>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-ink-muted">
            Jev classifies the request. Your routing rules turn that assessment
            into an operational decision.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ${status.className}`}
        >
          {assessment.status === "pending" ? (
            <CircleDashed aria-hidden="true" className="h-3.5 w-3.5" />
          ) : assessment.status === "complete" ? (
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {status.label}
        </span>
      </div>

      <div className="mt-5 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)]">
        <div className="rounded-lg bg-background p-4 ring-1 ring-border">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Jev assesses</h3>
            {assessment.model ? (
              <span className="truncate rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-muted ring-1 ring-border">
                {assessment.model}
              </span>
            ) : null}
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <Detail label="Issue type" value={labelize(assessment.issueType)} />
            <Detail label="Urgency" value={labelize(assessment.urgency)} />
            <Detail
              label="Suggested team"
              value={assessment.suggestedTeam || "Not reported"}
            />
            <Detail
              label="Confidence"
              value={confidenceLabel(assessment.confidence)}
            />
          </dl>
          {assessment.explanation ? (
            <p className="mt-3 text-pretty text-[13px] leading-5 text-ink-muted">
              {assessment.explanation}
            </p>
          ) : null}
        </div>

        <div
          className="hidden items-center justify-center lg:flex"
          aria-hidden="true"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent ring-1 ring-blue-100">
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>

        <div className="rounded-lg bg-accent-soft p-4 ring-1 ring-border">
          <div className="flex items-center gap-2">
            <Route aria-hidden="true" className="h-4 w-4 text-ink" />
            <h3 className="text-sm font-semibold text-ink">
              Your software routes
            </h3>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <Detail
              label="Assigned queue"
              value={routing.assignedQueue || "Awaiting route"}
            />
            <Detail label="Priority" value={labelize(routing.priority)} />
            <Detail
              label="Response deadline"
              value={routing.responseDeadline || "Not set"}
            />
            <Detail
              label="Triage path"
              value={
                routing.needsHumanTriage ? "Human review" : "Rules applied"
              }
            />
          </dl>
          {routing.routingReason ? (
            <p className="mt-3 text-pretty text-[13px] leading-5 text-ink-muted">
              {routing.routingReason}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2.5 text-pretty text-[12px] leading-5 text-ink-muted ring-1 ring-border">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
        />
        Jev supplies an assessment; assignment, priority, and response deadlines
        are calculated by your configured rules.
      </p>
    </section>
  );
}
