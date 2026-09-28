import type { Metadata } from "next";
import { HelpdeskShell } from "@/components/helpdesk-shell";
import { ManagerQualityConsole } from "@/components/jev/manager-quality-console";
import { getManagerQualityData } from "@/lib/quality-dashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quality - Alert Triage",
};

export default async function QualityPage() {
  const data = await getManagerQualityData(30);
  const cohorts = data.rows.map((row) => ({
    id: `${row.technicianId}:${row.role}:${row.issueType}:${row.model}:${row.rubricVersion}:${row.procedureVersion}`,
    technician: row.technician,
    role: row.role,
    issueType: row.issueType.replaceAll("_", " "),
    reviewBasis: `${row.model} / ${row.rubricVersion} / ${row.procedureVersion}`,
    handledTickets: row.handledTickets,
    medianResponseMinutes: row.medianResponseMinutes,
    averageResponseMinutes: row.averageResponseMinutes,
    reopenedRate: row.reopenedRate,
    qualityScore: row.qualityScore,
    scoredCriteria: row.scoredCriteria,
    missingEvidence: row.missingEvidenceCount,
    sampleSize: row.reviewedTickets,
  }));

  return (
    <HelpdeskShell
      active="quality"
      title="Work quality, with evidence"
      subtitle={`Manager view / last ${data.windowDays} days`}
    >
      <section className="page-content grid gap-6">
        <ManagerQualityConsole cohorts={cohorts} uniqueHandledTickets={data.summary.handledTickets} />
        {!data.dbError && <section className="surface-card p-6">
          <p className="section-kicker">Evidence before decisions</p><h2 className="text-balance text-lg font-semibold">Recent review examples</h2>
          <p className="mt-2 text-sm text-ink-muted">Open a ticket to inspect its source history, evidence gaps, and rubric results. Historical completions with unknown ownership remain unattributed.</p>
          <div className="mt-4 divide-y divide-border">{!data.examples?.length ? <p className="py-4 text-sm text-ink-muted">Completed-ticket reviews will appear here.</p> : data.examples.map((example, index) => <Link key={`${example.ticketId}-${index}`} href={`/tickets/${example.ticketId}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-4 text-sm hover:text-accent">
            <div><p className="font-semibold">{example.ticketTitle}</p><p className="mt-1 text-xs text-ink-muted">{example.technician ?? "Unattributed"} · {example.issueType?.replaceAll("_", " ") ?? "Unclassified"}</p></div>
            <span className="tabular-nums">{example.status === "succeeded" ? `${example.overallScore === null ? "Not enough evidence to score" : `${Math.round(example.overallScore)}% evidenced quality`} · ${example.missingEvidence} evidence gaps` : example.status.replaceAll("_", " ")}</span>
          </Link>)}</div>
        </section>}
        {data.dbError ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-pretty text-sm text-amber-900 ring-1 ring-amber-200">
            Live quality data is unavailable. No employee metrics are shown
            until the database query succeeds. {data.dbError}
          </p>
        ) : null}
      </section>
    </HelpdeskShell>
  );
}
