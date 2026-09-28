"use client";
import Link from "next/link";
import { useState } from "react";

type Assessment = { id: string; ticket_id: string; ticket_number: string; kind: string; status: string; attempt_count: number; last_error: string | null };
type Operations = {
  jev: { counts: Record<string, number>; assessments: Assessment[]; oldestPendingAt: string | null };
  providers: Record<string, { configured: boolean; lastStatus: string; lastSyncAt: string | null; pendingTickets?: number; failedTickets?: number }>;
  strongAccess: boolean;
  notifications: { id: string; ticket_id: string; ticket_title: string; kind: string; title: string; message: string; status: string; severity: string; opened_at: string }[];
  writeback: {
    configuration: { provider: string; enabled: boolean; autoApprove: boolean; secureManagerAccess: boolean }[];
    proposals: { id: string; ticket_id: string; ticket_title: string; provider: string; status: string;
      proposal: { priority: string; assignedUserId?: string }; desired: { priority?: string; user_id?: number };
      last_error: string | null; attempts: number }[];
  };
};

export function OperationsPanel() {
  const [data, setData] = useState<Operations | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Manager controls for imports and assessment recovery. Load status to inspect outstanding work.");
  async function refresh() {
    const response = await fetch("/api/operations", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in with a manager account to access operations." : result.error || "Unable to load status");
    setData(result);
  }
  async function run(action?: string, id?: string, reason?: string) {
    setBusy(true);
    try {
      if (action) {
        const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, reason }) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Action failed");
        setMessage(action.startsWith("retry") ? "Queued for retry. Process the queue or wait for the next scheduled run." : `Completed: ${action.replaceAll("_", " ")}. Status refreshed below.`);
      } else setMessage("Status refreshed. Scheduled jobs run every five minutes.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to complete action"); }
    finally { setBusy(false); }
  }
  return <section className="surface-card p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="section-kicker">Workflow controls</p><h2 className="text-lg font-semibold">Operations & recovery</h2></div>
      <button type="button" disabled={busy} onClick={() => run()} className="btn-soft px-4 disabled:opacity-50">Refresh status</button></div>
    <p className="mt-3 text-sm text-ink-muted" role="status" aria-live="polite">{busy ? "Working… this may take a few minutes for a full import batch." : message}</p>
    {data && <>
      {!data.strongAccess && <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Temporary access credentials are still in use. Set unique passwords of at least 16 characters before importing real customer data or enabling source writes.</p>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{Object.entries(data.providers).map(([provider, status]) => <div key={provider} className="surface-inset p-4">
        <h3 className="font-semibold capitalize">{provider === "repairshopr" ? "RepairShopr" : "Syncro"}</h3>
        <p className="mt-2 text-sm text-ink-muted">{status.configured ? `Last run: ${status.lastStatus}. ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "No completed sync yet."}` : "Account subdomain and API key are not configured."}</p>
        {status.configured && <p className="mt-2 text-xs tabular-nums text-ink-muted">Pending imports: {status.pendingTickets ?? 0} · Failed awaiting retry: {status.failedTickets ?? 0}</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !status.configured} onClick={() => run(`test_${provider}`)} className="btn-soft px-3 disabled:opacity-50">Test connection</button><button disabled={busy || !status.configured} onClick={() => run(`sync_${provider}`)} className="btn-primary px-3 disabled:opacity-50">Import next batch</button></div>
      </div>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Manager attention</h3><button disabled={busy} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("scan_alerts")}>Check deadlines & routing</button></div>
      <p className="mt-2 text-xs text-ink-muted">In-app operational alerts, not employee scores. Acknowledged alerts stay visible until the condition clears. These do not send email or change source tickets.</p>
      <div className="mt-3 divide-y divide-border">{data.notifications.length === 0 ? <p className="py-3 text-sm text-ink-muted">No outstanding operational alerts.</p> : data.notifications.map(alert => <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div><p className="text-sm font-semibold">{alert.title}</p><Link href={`/tickets/${alert.ticket_id}`} className="mt-1 text-sm text-accent underline">{alert.ticket_title}</Link><p className="mt-1 text-xs text-ink-muted">{alert.message} · {alert.status}</p></div>
        {alert.status === "open" && <button disabled={busy} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("ack_alert", alert.id)}>Acknowledge alert</button>}
        {alert.kind === "human_triage" && <div className="grid w-full gap-2 sm:grid-cols-[1fr_auto]"><label className="grid gap-1 text-xs text-ink-muted">Manager routing review<input className="input-field min-h-11 px-3 text-sm" value={reviewNotes[alert.id] ?? ""} maxLength={2000} onChange={event => setReviewNotes(value => ({ ...value, [alert.id]: event.target.value }))} placeholder="After assigning in the source and importing, explain your routing decision" /></label><button disabled={busy || (reviewNotes[alert.id]?.trim().length ?? 0) < 8} onClick={() => run("confirm_human_triage", alert.ticket_id, reviewNotes[alert.id])} className="btn-soft min-h-11 self-end px-4 disabled:opacity-50">Confirm human review</button></div>}
      </div>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Jev assessment queue</h3><button disabled={busy} onClick={() => run("process_assessments")} className="btn-primary px-4 disabled:opacity-50">Process next batch</button></div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">{Object.entries(data.jev.counts).map(([status, count]) => <span key={status}>{status.replaceAll("_", " ")}: <strong className="tabular-nums text-ink">{count}</strong></span>)}</div>
      {data.jev.oldestPendingAt && <p className="mt-2 text-xs text-ink-muted">Oldest outstanding assessment: {new Date(data.jev.oldestPendingAt).toLocaleString()}</p>}
      <div className="mt-4 divide-y divide-border">{data.jev.assessments.length === 0 ? <p className="py-4 text-sm text-ink-muted">No outstanding assessments.</p> : data.jev.assessments.map((assessment) => <div key={assessment.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div><Link className="text-sm font-semibold text-accent underline" href={`/tickets/${assessment.ticket_id}`}>Ticket {assessment.ticket_number}</Link><p className="mt-1 text-xs text-ink-muted">{assessment.kind.replaceAll("_", " ")} · {assessment.status.replaceAll("_", " ")} · {assessment.attempt_count} attempts</p>{assessment.last_error && <p className="mt-1 text-xs text-red-700">{assessment.last_error}</p>}</div>
        {["failed", "retryable", "not_configured"].includes(assessment.status) && <button disabled={busy} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("retry_assessment", assessment.id)}>Retry assessment</button>}
      </div>)}</div>
      <div className="mt-6 border-t border-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Source routing approvals</h3><button disabled={busy} className="btn-primary px-4 disabled:opacity-50" onClick={() => run("process_writebacks")}>Process approved changes</button></div>
        <p className="mt-2 text-sm text-ink-muted">Jev recommends priority and a technician for unassigned tickets. Teams and response deadlines stay in this workspace. Approval requires source writes to be enabled, account-specific priority mappings, and secure manager access. Conflicts require a fresh import and triage; they are never blindly retried.</p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">{data.writeback.configuration.map(config => <span key={config.provider} className="capitalize">{config.provider}: {config.enabled ? config.autoApprove ? "automatic approval enabled" : "manager approval required" : "source writes disabled"}</span>)}</div>
        <div className="mt-3 divide-y divide-border">{data.writeback.proposals.length === 0 ? <p className="py-4 text-sm text-ink-muted">No source routing proposals yet. They appear after imported tickets have been triaged.</p> : data.writeback.proposals.map(proposal => {
          const config = data.writeback.configuration.find(value => value.provider === proposal.provider);
          const approvable = ["awaiting_approval", "blocked", "failed"].includes(proposal.status);
          return <div key={proposal.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div><Link className="text-sm font-semibold text-accent underline" href={`/tickets/${proposal.ticket_id}`}>{proposal.ticket_title}</Link>
              <p className="mt-1 text-xs text-ink-muted">{proposal.provider} · {proposal.status.replaceAll("_", " ")} · priority {proposal.proposal.priority}{proposal.desired.priority ? ` → ${proposal.desired.priority}` : " (mapping required)"}{proposal.desired.user_id ? ` · source technician #${proposal.desired.user_id}` : proposal.proposal.assignedUserId ? " · technician mapping required" : " · existing technician retained"}</p>
              {proposal.last_error && <p className="mt-1 text-xs text-red-700">{proposal.last_error.replaceAll("_", " ")}</p>}
            </div>
            {approvable && <button disabled={busy || !config?.enabled || !config.secureManagerAccess} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("approve_writeback", proposal.id)}>Approve source change</button>}
            {proposal.status === "retryable" && <button disabled={busy} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("retry_writeback", proposal.id)}>Return to approval</button>}
            {["conflict", "superseded"].includes(proposal.status) && <button disabled={busy} className="btn-soft px-4 disabled:opacity-50" onClick={() => run("retriage_ticket", proposal.ticket_id)}>Request fresh triage</button>}
          </div>;
        })}</div>
      </div>
    </>}
  </section>;
}
