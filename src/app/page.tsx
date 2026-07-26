import { HomeConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dashboard = await getDashboardData({
    ticketScope: "active",
    ticketLimit: 20,
  });

  return <HomeConsole initialData={dashboard} />;
}
