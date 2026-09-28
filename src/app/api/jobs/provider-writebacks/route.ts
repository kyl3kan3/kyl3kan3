import { isScheduledJobAuthorized } from "@/lib/job-auth";
import { processProviderWritebacks } from "@/lib/provider-writeback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  if (!isScheduledJobAuthorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...await processProviderWritebacks() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Unable to process provider write-backs. Inspect manager operations." }, { status: 503 });
  }
}
export const GET = run;
export const POST = run;
