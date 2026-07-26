import type { Metadata } from "next";
import { TicketDetailConsole } from "@/components/guided-helpdesk";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "Ticket - Alert Triage",
};

export default async function TicketPage({ params }: PageProps) {
  const { id } = await params;
  const dashboard = await getDashboardData({ ticketId: id });

  return <TicketDetailConsole initialData={dashboard} ticketId={id} />;
}
