import type { Metadata } from "next";
import { TriageConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Archive - Alert Triage",
};

export default async function ArchivePage() {
  const dashboard = await getDashboardData({
    ticketScope: "archive",
    ticketLimit: 100,
  });

  return (
    <TriageConsole
      initialData={dashboard}
      active="archive"
      title="Done archive"
      subtitle="Archive"
      mode="archive"
    />
  );
}
