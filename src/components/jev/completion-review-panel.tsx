import {
  Calculator,
  CheckCircle2,
  CircleAlert,
  CircleSlash2,
  HelpCircle,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react";

export type CompletionCriterionStatus =
  | "met"
  | "not_met"
  | "missing_evidence"
  | "not_applicable";

export type CompletionReviewCriterion = {
  id: string;
  label: string;
  description?: string | null;
  status: CompletionCriterionStatus;
  score: number | null;
  maxScore?: number | null;
  evidence?: string | null;
};

export type CompletionReviewPanelProps = {
  criteria: CompletionReviewCriterion[];
  reviewStatus?: "complete" | "pending" | "unavailable" | "error";
  reviewedAt?: string | null;
  model?: string | null;
  className?: string;
};

const criterionPresentation: Record<
  CompletionCriterionStatus,
  {
    label: string;
    className: string;
    Icon: typeof CheckCircle2;
  }
> = {
  met: {
    label: "Met",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    Icon: CheckCircle2,
  },
  not_met: {
    label: "Not met",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
    Icon: XCircle,
  },
  missing_evidence: {
    label: "Missing evidence",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    Icon: CircleAlert,
  },
  not_applicable: {
    label: "Not applicable",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
    Icon: CircleSlash2,
  },
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function CompletionReviewPanel({
  criteria,
  reviewStatus = "complete",
  reviewedAt,
  model,
  className = "",
}: CompletionReviewPanelProps) {
  const applicable = criteria.filter(
    (criterion) => criterion.status !== "not_applicable",
  );
  const evidenced = applicable.filter(
    (criterion) => criterion.status !== "missing_evidence",
  );
  const coverage = applicable.length
    ? clampPercent(Math.round((evidenced.length / applicable.length) * 100))
    : null;
  const scored = criteria.filter(
    (criterion) =>
      criterion.score != null && criterion.status !== "missing_evidence",
  );
  const scoreTotal = scored.reduce(
    (sum, criterion) => sum + (criterion.score ?? 0),
    0,
  );
  const maxTotal = scored.reduce(
    (sum, criterion) => sum + (criterion.maxScore ?? 1),
    0,
  );
  const quality =
    maxTotal > 0 ? Math.round((scoreTotal / maxTotal) * 100) : null;
  const missingEvidenceCount = criteria.filter(
    (criterion) => criterion.status === "missing_evidence",
  ).length;

  return (
    <section
      aria-labelledby="jev-completion-review-title"
      className={`rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-accent">
            <SearchCheck aria-hidden="true" className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">
              Completed ticket
            </span>
          </div>
          <h2
            id="jev-completion-review-title"
            className="mt-2 text-balance text-xl font-semibold tracking-tight text-ink"
          >
            Jev completion review
          </h2>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-ink-muted">
            Evidence is checked against your procedures before the software
            includes a criterion in quality metrics.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {model ? (
            <span className="rounded-full bg-background px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-muted ring-1 ring-border">
              {model}
            </span>
          ) : null}
          <span
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ${
              reviewStatus === "complete"
                ? "bg-accent-soft text-accent ring-blue-100"
                : reviewStatus === "pending"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200"
            }`}
          >
            {reviewStatus === "complete"
              ? "Review complete"
              : reviewStatus === "pending"
                ? "Review pending"
                : reviewStatus === "unavailable"
                  ? "Jev unavailable"
                  : "Review failed"}
          </span>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-background p-4 ring-1 ring-border">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            <Calculator aria-hidden="true" className="h-3.5 w-3.5" />
            Scored quality
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-ink">
            {quality == null ? "—" : `${quality}%`}
          </dd>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            {scored.length} scored{" "}
            {scored.length === 1 ? "criterion" : "criteria"}
          </p>
        </div>
        <div className="rounded-lg bg-background p-4 ring-1 ring-border">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Evidence coverage
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-ink">
            {coverage == null ? "—" : `${coverage}%`}
          </dd>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            {evidenced.length} of {applicable.length} applicable
          </p>
        </div>
        <div className="rounded-lg bg-amber-50/70 p-4 ring-1 ring-amber-200">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-amber-800">
            <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
            Missing evidence
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-amber-900">
            {missingEvidenceCount}
          </dd>
          <p className="mt-1 text-[12px] leading-5 text-amber-800">
            Flagged for follow-up, not scored as failure
          </p>
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        {criteria.length ? (
          criteria.map((criterion) => {
            const presentation = criterionPresentation[criterion.status];
            const Icon = presentation.Icon;
            const isUnscored = criterion.score == null;

            return (
              <article
                key={criterion.id}
                className="rounded-lg border border-border bg-surface-muted p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-balance text-sm font-semibold text-ink">
                      {criterion.label}
                    </h3>
                    {criterion.description ? (
                      <p className="mt-1 text-pretty text-[13px] leading-5 text-ink-muted">
                        {criterion.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${presentation.className}`}
                    >
                      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                      {presentation.label}
                    </span>
                    <span
                      className="min-w-12 rounded-full bg-white px-2.5 py-1 text-center text-[11px] font-semibold tabular-nums text-ink ring-1 ring-border"
                      aria-label={
                        isUnscored
                          ? "No score"
                          : `Score ${criterion.score} of ${criterion.maxScore ?? 1}`
                      }
                    >
                      {isUnscored
                        ? "—"
                        : `${criterion.score}/${criterion.maxScore ?? 1}`}
                    </span>
                  </div>
                </div>
                {criterion.evidence ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-white px-3 py-2.5 text-pretty text-[12px] leading-5 text-ink-muted ring-1 ring-border">
                    <HelpCircle
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                    />
                    {criterion.evidence}
                  </p>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface-muted p-6 text-center text-sm text-ink-muted">
            No review criteria are available yet.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-2 rounded-lg bg-accent-soft/70 px-3 py-3 text-[12px] leading-5 text-blue-900 ring-1 ring-blue-100">
        <p className="flex max-w-2xl items-start gap-2 text-pretty">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          Jev assesses the ticket artifacts. The software calculates metrics
          from scored evidence, and managers make coaching or staffing
          decisions.
        </p>
        {reviewedAt ? (
          <span className="font-medium tabular-nums">
            Reviewed {reviewedAt}
          </span>
        ) : null}
      </div>
    </section>
  );
}
