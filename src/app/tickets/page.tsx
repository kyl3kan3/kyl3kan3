import type { Metadata } from "next";
import { TriageConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tickets - Alert Triage",
};

export default async function TicketsPage() {
  const dashboard = await getDashboardData();

  return (
    <TriageConsole
      initialData={dashboard}
      active="tickets"
      title="All tickets"
      subtitle="Tickets"
    />
  );
}
