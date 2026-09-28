import { isScheduledJobAuthorized } from "@/lib/job-auth";
import { processWorkflowNotifications } from "@/lib/workflow-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(request: Request) {
  if (!isScheduledJobAuthorized(request)) return Response.json({ ok:false,error:"Unauthorized" },{ status:401 });
  try {
    return Response.json({ ok:true,...await processWorkflowNotifications() },{ headers:{ "cache-control":"no-store" } });
  } catch {
    return Response.json({ ok:false,error:"Unable to refresh workflow notifications." },{ status:503,headers:{ "cache-control":"no-store" } });
  }
}
export const GET = run;
export const POST = run;
