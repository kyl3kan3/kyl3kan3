import type { Metadata } from "next";
import { HelpdeskShell } from "@/components/helpdesk-shell";
import { ManagerQualityConsole } from "@/components/jev/manager-quality-console";
import { getManagerQualityData } from "@/lib/quality-dashboard";

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
      <section className="mx-auto grid max-w-[1180px] gap-5 px-4 py-5 sm:px-6">
        <ManagerQualityConsole cohorts={cohorts} />
        {data.dbError ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-pretty text-sm text-amber-900 ring-1 ring-amber-200">
            Live quality data is unavailable. No employee metrics are shown
            until the database query succeeds. {data.dbError}
          </p>
        ) : null}
      </section>
    </HelpdeskShell>
  );
}
