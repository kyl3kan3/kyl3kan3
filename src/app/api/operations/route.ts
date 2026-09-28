import { managerRequestFailure, hasStrongProductionAccess } from "@/lib/manager-request";
import { getAssessmentOperations, operationsOrgId, retryAssessment, retriageTicket, confirmHumanTriage, getImportBacklogs } from "@/lib/operations-status";
import { processQueuedJevAssessments } from "@/lib/jev-assessments";
import { getRepairShoprStatus, syncRepairShopr, testRepairShoprConnection } from "@/lib/repairshopr";
import { getSyncroStatus, syncSyncro, testSyncroConnection } from "@/lib/syncro";
import { getProviderWritebackStatus, listProviderWritebacks, approveProviderWriteback,
  retryProviderWriteback, processProviderWritebacks } from "@/lib/provider-writeback";
import { listWorkflowNotifications, ackWorkflowNotification, processWorkflowNotifications } from "@/lib/workflow-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "cache-control": "no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    const orgId = await operationsOrgId();
    const [jev, repairshopr, syncro, writeback, proposals, notifications, imports] = await Promise.all([
      getAssessmentOperations(orgId), getRepairShoprStatus(), getSyncroStatus(),
      getProviderWritebackStatus(orgId), listProviderWritebacks(orgId),
      listWorkflowNotifications(orgId),
      getImportBacklogs(orgId),
    ]);
    return Response.json({ ok: true, jev, providers: {
      repairshopr: { ...repairshopr,...imports.repairshopr },
      syncro: { ...syncro,...imports.syncro },
    }, writeback: { ...writeback, proposals }, notifications, strongAccess: hasStrongProductionAccess() }, { headers });
  } catch {
    return Response.json({ ok: false, error: "Unable to read operations. Check the database connection." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Invalid action" }, { status: 400, headers });
  try {
    let result: unknown;
    switch (body.action) {
      case "process_assessments": result = await processQueuedJevAssessments(5); break;
      case "retry_assessment":
        if (typeof body.id !== "string" || !uuid.test(body.id)) return Response.json({ ok: false, error: "Invalid assessment ID" }, { status: 400, headers });
        result = await retryAssessment(await operationsOrgId(), body.id); break;
      case "retriage_ticket":
        if (typeof body.id !== "string" || !uuid.test(body.id)) return Response.json({ ok: false, error: "Invalid ticket ID" }, { status: 400, headers });
        result = await retriageTicket(await operationsOrgId(), body.id); break;
      case "approve_writeback":
      case "retry_writeback":
        if (typeof body.id !== "string" || !uuid.test(body.id)) return Response.json({ ok: false, error: "Invalid write-back ID" }, { status: 400, headers });
        result = await (body.action === "approve_writeback" ? approveProviderWriteback : retryProviderWriteback)(await operationsOrgId(), body.id); break;
      case "process_writebacks": result = await processProviderWritebacks({ orgId: await operationsOrgId(), limit: 10 }); break;
      case "scan_alerts": result = await processWorkflowNotifications({ orgId: await operationsOrgId() }); break;
      case "confirm_human_triage":
        if (typeof body.id !== "string" || !uuid.test(body.id) || typeof body.reason !== "string") return Response.json({ ok: false, error: "Ticket ID and review explanation are required" }, { status: 400, headers });
        result = await confirmHumanTriage(await operationsOrgId(), body.id, body.reason);
        await processWorkflowNotifications({ orgId: await operationsOrgId() }); break;
      case "ack_alert":
        if (typeof body.id !== "string" || !uuid.test(body.id)) return Response.json({ ok: false, error: "Invalid alert ID" }, { status: 400, headers });
        result = await ackWorkflowNotification(await operationsOrgId(), body.id); break;
      case "sync_repairshopr": result = await syncRepairShopr(); break;
      case "test_repairshopr": result = await testRepairShoprConnection(); break;
      case "sync_syncro": result = await syncSyncro(); break;
      case "test_syncro": result = await testSyncroConnection(); break;
      default: return Response.json({ ok: false, error: "Unknown action" }, { status: 400, headers });
    }
    return Response.json({ ok: true, result }, { headers });
  } catch {
    return Response.json({ ok: false, error: "Action could not complete. Check provider configuration and refresh the job status before retrying." }, { status: 400, headers });
  }
}
