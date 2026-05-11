import type { Metadata } from "next";
import { OverviewConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview - Alert Triage",
};

export default async function OverviewPage() {
  const dashboard = await getDashboardData();

  return <OverviewConsole initialData={dashboard} />;
}
