"use client";

import { useState } from "react";

export function SyncroIntegrationCard() {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter your sync secret to check the connection.");
  const [failed, setFailed] = useState(false);

  async function run(action: "status" | "test" | "sync") {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/integrations/syncro/${action}`, {
        method: action === "status" ? "GET" : "POST",
        headers: { "x-syncro-sync-secret": secret.trim() },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Syncro request failed");
      setMessage(action === "sync"
        ? `Imported ${result.customersSynced} customers and ${result.ticketsSynced} tickets. Refresh the queue to see updates.`
        : action === "test"
          ? "Syncro API connection verified. Run sync to import tickets."
          : `${result.config.configured ? "Configured" : "Credentials missing"}. Last sync: ${result.status.lastSyncAt ?? "Never"}. ${result.status.lastError ?? ""}`);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Syncro request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Syncro mirror</h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">Import customers and tickets from Syncro. Ticket status remains owned by Syncro; this integration does not write back.</p>
      <p className="mt-3 text-sm leading-6 text-ink-muted">Store SYNCRO_SUBDOMAIN, SYNCRO_API_KEY, and SYNCRO_SYNC_SECRET in server environment variables. Scheduled imports also require CRON_SECRET.</p>
      <label className="mt-4 grid gap-2 text-sm font-medium text-ink">
        Syncro sync secret
        <input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} className="h-11 rounded-lg border border-border px-3" placeholder="For protected integration controls" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["status", "test", "sync"] as const).map((action) => (
          <button key={action} type="button" disabled={busy || !secret.trim()} onClick={() => run(action)} className="btn-soft rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {action === "status" ? "Refresh status" : action === "test" ? "Test connection" : "Sync now"}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className={`mt-3 text-sm ${failed ? "text-red-700" : "text-ink-muted"}`}>{busy ? "Checking Syncro…" : message}</p>
      <p className="mt-3 text-xs leading-5 text-ink-muted">Imports include ticket summaries, not guaranteed complete technician histories. Missing evidence is flagged for review, not treated as poor performance.</p>
    </section>
  );
}
