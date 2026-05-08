import { TriageConsole } from "@/components/triage-console";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dashboard = await getDashboardData();

  return <TriageConsole initialData={dashboard} />;
}
