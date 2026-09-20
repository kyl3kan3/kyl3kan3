import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { isManagerDashboardAuthorized, managerDashboardAccessFailure } from "@/lib/manager-auth";
import { isJevConfigured } from "@/lib/jev-config";
import { classifyTicketWithJev } from "@/lib/jev";
import { getRepairShoprConfig, testRepairShoprConnection } from "@/lib/repairshopr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isManagerDashboardAuthorized(request)) return managerDashboardAccessFailure();
  let database = false;
  let backlog: {pending: number; failed: number} | null = null;
  if (hasDatabaseUrl()) {
    try {
      const sql = getSql();
      await sql`select 1`; database = true;
      const table = await sql`select to_regclass('repairshopr_import_queue') as name`;
      if(table[0]?.name) {
        const counts=await sql`select count(*) filter(where pending)::int as pending,count(*) filter(where pending and last_error is not null)::int as failed from repairshopr_import_queue`;
        backlog={pending:Number(counts[0].pending),failed:Number(counts[0].failed)};
      }
    } catch { database=false; }
  }
  const checks={database,appAccess:Boolean(process.env.APP_ACCESS_PASSWORD?.trim()),managerAccess:Boolean(process.env.MANAGER_DASHBOARD_PASSWORD?.trim()),
    scheduledJobs:Boolean(process.env.CRON_SECRET?.trim()),jevCredentials:isJevConfigured(),repairshopr:getRepairShoprConfig().configured,
    manualSync:Boolean(process.env.REPAIRSHOPR_SYNC_SECRET?.trim())};
  return NextResponse.json({ok:true,ready:Object.values(checks).every(Boolean),checks,backlog,
    note:"Configured credentials are not proof of connectivity. Run live checks after adding the RepairShopr subdomain and API key."},{headers:{"cache-control":"no-store"}});
}

export async function POST(request: Request) {
  if (!isManagerDashboardAuthorized(request)) return managerDashboardAccessFailure();
  // Synthetic sample only: no ticket or employee data is created or modified.
  const jev=await classifyTicketWithJev({ticket:{title:"Synthetic readiness test: application will not open",description:"A single user needs help opening a desktop application."},teams:[{id:"readiness-helpdesk",name:"Helpdesk"}]});
  let repairshopr: string="credentials_missing";
  if(getRepairShoprConfig().configured) {
    try { await testRepairShoprConnection();repairshopr="verified"; }
    catch { repairshopr="failed: check subdomain, API key, and customer/ticket/user read permissions"; }
  }
  return NextResponse.json({ok:jev.status==="succeeded" && repairshopr==="verified",jev:{status:jev.status,error:jev.error},repairshopr},
    {headers:{"cache-control":"no-store"}});
}
