import {
  Calculator,
  CircleAlert,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

export type ManagerQualityCohort = {
  id: string;
  technician: string;
  role: string;
  issueType: string;
  reviewBasis: string;
  handledTickets: number;
  medianResponseMinutes: number | null;
  averageResponseMinutes: number | null;
  reopenedRate: number | null;
  qualityScore: number | null;
  scoredCriteria: number;
  missingEvidence: number;
  sampleSize: number;
};

export type ManagerQualityConsoleProps = {
  cohorts: ManagerQualityCohort[];
  title?: string;
  description?: string;
  className?: string;
};

function formatMinutes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 60) return `${Math.round(value)}m`;
  const hours = value / 60;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`;
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatRate(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value * 100);
}

function CohortCard({ cohort }: { cohort: ManagerQualityCohort }) {
  return (
    <article className="rounded-lg border border-border bg-surface-muted p-4 lg:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-balance text-sm font-semibold text-ink">
            {cohort.technician}
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {cohort.role} / {cohort.issueType}
          </p>
          <p className="mt-1 max-w-[18rem] truncate font-mono text-[10px] text-ink-muted">
            {cohort.reviewBasis}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold tabular-nums text-ink ring-1 ring-border">
          n={cohort.sampleSize}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Handled" value={String(cohort.handledTickets)} />
        <Metric
          label="Response (med / avg)"
          value={`${formatMinutes(cohort.medianResponseMinutes)} / ${formatMinutes(cohort.averageResponseMinutes)}`}
        />
        <Metric label="Reopened" value={formatRate(cohort.reopenedRate)} />
        <Metric
          label="Scored quality"
          value={formatPercent(cohort.qualityScore)}
        />
        <Metric label="Scored criteria" value={String(cohort.scoredCriteria)} />
        <Metric
          label="Missing evidence"
          value={String(cohort.missingEvidence)}
          warning
        />
      </dl>
    </article>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-lg bg-white px-3 py-2.5 ring-1 ${warning ? "ring-amber-200" : "ring-border"}`}
    >
      <dt
        className={`text-[10px] font-semibold uppercase tracking-[0.07em] ${warning ? "text-amber-800" : "text-ink-muted"}`}
      >
        {label}
      </dt>
      <dd
        className={`mt-1 font-semibold tabular-nums ${warning ? "text-amber-900" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function ManagerQualityConsole({
  cohorts,
  title = "Comparable quality cohorts",
  description = "Compare people doing similar work. Quality includes only criteria with enough evidence to score.",
  className = "",
}: ManagerQualityConsoleProps) {
  const sortedCohorts = [...cohorts].sort(
    (left, right) =>
      left.technician.localeCompare(right.technician, undefined, {
        sensitivity: "base",
      }) ||
      left.role.localeCompare(right.role, undefined, { sensitivity: "base" }) ||
      left.issueType.localeCompare(right.issueType, undefined, {
        sensitivity: "base",
      }) ||
      left.reviewBasis.localeCompare(right.reviewBasis, undefined, {
        sensitivity: "base",
      }),
  );
  const totalHandled = cohorts.reduce(
    (sum, cohort) => sum + cohort.handledTickets,
    0,
  );
  const totalMissingEvidence = cohorts.reduce(
    (sum, cohort) => sum + cohort.missingEvidence,
    0,
  );
  const totalScored = cohorts.reduce(
    (sum, cohort) => sum + cohort.scoredCriteria,
    0,
  );

  return (
    <section
      aria-labelledby="manager-quality-console-title"
      className={`rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-accent">
            <UsersRound aria-hidden="true" className="h-4 w-4" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">
              Manager dashboard
            </span>
          </div>
          <h2
            id="manager-quality-console-title"
            className="mt-2 text-balance text-xl font-semibold tracking-tight text-ink"
          >
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-ink-muted">
            {description}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-accent ring-1 ring-blue-100">
          <UserRoundCheck aria-hidden="true" className="h-3.5 w-3.5" />
          {cohorts.length} comparable{" "}
          {cohorts.length === 1 ? "cohort" : "cohorts"}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-background p-4 ring-1 ring-border">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            Tickets handled
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {totalHandled}
          </dd>
        </div>
        <div className="rounded-lg bg-background p-4 ring-1 ring-border">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            <Calculator aria-hidden="true" className="h-3.5 w-3.5" />
            Scored criteria
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {totalScored}
          </dd>
        </div>
        <div className="rounded-lg bg-amber-50/70 p-4 ring-1 ring-amber-200">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-amber-800">
            <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
            Missing evidence
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {totalMissingEvidence}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        {sortedCohorts.map((cohort) => (
          <CohortCard key={cohort.id} cohort={cohort} />
        ))}
      </div>

      <div className="mt-4 hidden overflow-hidden rounded-lg border border-border lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
            <caption className="sr-only">
              Quality and workload metrics grouped by technician role and ticket
              issue type
            </caption>
            <thead className="bg-background text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Technician
                </th>
                <th scope="col" className="px-4 py-3">
                  Role
                </th>
                <th scope="col" className="px-4 py-3">
                  Issue type
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Handled
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Median response
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Average response
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Reopened
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Scored quality
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Missing evidence
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Sample
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white text-ink">
              {sortedCohorts.map((cohort) => (
                <tr key={cohort.id}>
                  <th scope="row" className="px-4 py-3 font-semibold text-ink">
                    {cohort.technician}
                  </th>
                  <td className="px-4 py-3 text-ink-muted">{cohort.role}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    <div>{cohort.issueType}</div>
                    <div className="mt-0.5 max-w-56 truncate font-mono text-[10px] text-ink-muted">
                      {cohort.reviewBasis}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {cohort.handledTickets}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMinutes(cohort.medianResponseMinutes)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMinutes(cohort.averageResponseMinutes)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatRate(cohort.reopenedRate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold tabular-nums">
                      {formatPercent(cohort.qualityScore)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-muted">
                      {cohort.scoredCriteria} scored
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex min-w-8 justify-center rounded-full bg-amber-50 px-2 py-1 font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200">
                      {cohort.missingEvidence}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {cohort.sampleSize}
                  </td>
                </tr>
              ))}
              {!sortedCohorts.length ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-ink-muted"
                  >
                    No comparable cohorts are available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {!sortedCohorts.length ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-muted p-6 text-center text-sm text-ink-muted lg:hidden">
          No comparable cohorts are available yet.
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 rounded-lg bg-accent-soft/70 px-3 py-3 text-pretty text-[12px] leading-5 text-blue-900 ring-1 ring-blue-100">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        Jev assesses ticket artifacts. Your software calculates these metrics.
        Managers review examples and make employee decisions—never Jev.
        Technician attribution uses the ticket owner recorded at completion.
      </p>
    </section>
  );
}
