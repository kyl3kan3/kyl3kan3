import type { Metadata } from "next";
import { SettingsConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings - Alert Triage",
};

export default async function SettingsPage() {
  const dashboard = await getDashboardData();

  return <SettingsConsole initialData={dashboard} />;
}
