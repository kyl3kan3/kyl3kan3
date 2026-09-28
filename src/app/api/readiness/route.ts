import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { managerRequestFailure, hasStrongProductionAccess } from "@/lib/manager-request";
import { isJevConfigured } from "@/lib/jev-config";
import { classifyTicketWithJev, reviewCompletedWorkWithJev } from "@/lib/jev";
import { getRepairShoprConfig, testRepairShoprConnection } from "@/lib/repairshopr";
import { getSyncroConfig, testSyncroConnection } from "@/lib/syncro";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
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
  const providers = { repairshopr: getRepairShoprConfig().configured, syncro: getSyncroConfig().configured };
  const checks={database,appAccess:Boolean(process.env.APP_ACCESS_PASSWORD?.trim()),managerAccess:Boolean(process.env.MANAGER_DASHBOARD_PASSWORD?.trim()),
    secureAccess:hasStrongProductionAccess(),scheduledJobs:Boolean(process.env.CRON_SECRET?.trim()),jevCredentials:isJevConfigured(),
    ticketingProvider:providers.repairshopr || providers.syncro};
  return NextResponse.json({ok:true,ready:Object.values(checks).every(Boolean),checks,providers,backlog,
    warnings:[...(!checks.secureAccess ? ["Temporary shared credentials are for testing only. Use unique passwords of at least 16 characters before importing customer data."] : []),
      "Shared workspace sign-in does not authenticate an individual technician. Provider history supplies attribution; managers must review it."] ,
    note:"Configuration is not proof of connectivity. Test each configured provider in Operations, then verify a real import → triage → completion → review cycle."},{headers:{"cache-control":"no-store"}});
}

export async function POST(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  // Synthetic sample only: no ticket or employee data is created or modified.
  const jev=await classifyTicketWithJev({ticket:{title:"Synthetic readiness test: application will not open",description:"A single user needs help opening a desktop application."},teams:[{id:"readiness-helpdesk",name:"Helpdesk"}]});
  const review=await reviewCompletedWorkWithJev({ticket:{title:"Synthetic readiness test",issueType:"software"},
    history:[{at:new Date().toISOString(),action:"technician completion note",actor:"synthetic technician",evidence:"Repaired the application installation. Opened the application twice and confirmed it launched successfully. Told the customer they can resume work and reply if the issue returns."}],
    procedures:["Record actions, verification results, and customer next steps."]});
  const jevPassed=jev.status==="succeeded" && review.status==="succeeded";
  let repairshopr: string="credentials_missing";
  if(getRepairShoprConfig().configured) {
    try { await testRepairShoprConnection();repairshopr="verified"; }
    catch { repairshopr="failed: check subdomain, API key, and customer/ticket/user read permissions"; }
  }
  let syncro = "credentials_missing";
  if (getSyncroConfig().configured) {
    try { await testSyncroConnection(); syncro = "verified"; }
    catch { syncro = "failed: check subdomain, API key, and customer/ticket/user/comment read permissions"; }
  }
  const configuredResults = [getRepairShoprConfig().configured ? repairshopr : null, getSyncroConfig().configured ? syncro : null].filter(Boolean);
  return NextResponse.json({ok:jevPassed && configuredResults.length > 0 && configuredResults.every(value => value === "verified"),jev:{status:jevPassed?"succeeded":"failed",error:jev.error ?? review.error,triage:jev.status,completionReview:review.status},repairshopr,syncro},
    {headers:{"cache-control":"no-store"}});
}
