"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { RoutingRule } from "@/lib/routing-policy";

type RulesData = { rules: RoutingRule[]; teams: { id: string; name: string }[] };
type Draft = {
  id: string | null; name: string; isActive: boolean; order: string;
  issueType: string; urgency: string; source: string;
  priority: string; teamId: string; slaMinutes: string;
};
const freshDraft = (): Draft => ({ id: null, name: "", isActive: true, order: "100", issueType: "", urgency: "", source: "", priority: "", teamId: "", slaMinutes: "" });
const issues = ["account_access", "hardware", "software", "network", "security", "billing", "monitoring_alert", "other"];
const label = (value: string) => value.replaceAll("_", " ");
const fieldClass = "input-field min-h-11 w-full px-3 text-sm font-normal normal-case tracking-normal";
const labelClass = "grid min-w-0 gap-2 text-xs font-semibold text-ink-muted";
const buttonClass = "min-h-11 px-4 transition-transform motion-safe:active:scale-[0.96] disabled:opacity-50";

async function readRules(): Promise<RulesData> {
  const response = await fetch("/api/routing-rules", { cache: "no-store" });
  if (response.status === 401 || response.status === 403) throw new Error("Sign in with a manager account to manage routing rules.");
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load routing rules.");
  return data;
}

export function RoutingPolicyPanel() {
  const [data, setData] = useState<RulesData | null>(null);
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Loading routing rules…");
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readRules().then(result => {
      if (!cancelled) { setData(result); setMessage("Rules are checked in ascending order. The first active match wins."); }
    }).catch(reason => {
      if (!cancelled) { setError(true); setMessage(reason instanceof Error ? reason.message : "Unable to load routing rules."); }
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }

  async function refresh() {
    setBusy(true); setError(false);
    try { setData(await readRules()); setMessage("Routing rules refreshed."); }
    catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "Unable to refresh rules."); }
    finally { setBusy(false); }
  }

  async function mutate(method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown, success: string) {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/routing-rules", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) throw new Error("Manager access is required. Sign in again and retry.");
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The rule could not be saved.");
      if (method === "POST" || method === "PUT" || (method === "DELETE" && draft.id === (body as { id: string }).id)) setDraft(freshDraft());
      setDeleting(null);
      setMessage(success);
      try { setData(await readRules()); }
      catch { setError(true); setMessage(`${success} Reload the rules to verify the latest list.`); }
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "The action failed."); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      ...(draft.id ? { id: draft.id } : {}), name: draft.name, isActive: draft.isActive, order: Number(draft.order),
      match: { ...(draft.issueType ? { issueType: draft.issueType } : {}), ...(draft.urgency ? { urgency: draft.urgency } : {}), ...(draft.source.trim() ? { source: draft.source.trim() } : {}) },
      action: { ...(draft.priority ? { priority: draft.priority } : {}), ...(draft.teamId ? { teamId: draft.teamId } : {}), ...(draft.slaMinutes ? { slaMinutes: Number(draft.slaMinutes) } : {}) },
    };
    void mutate(draft.id ? "PUT" : "POST", body, "Rule saved. It applies to subsequent successful triage runs.");
  }

  function edit(rule: RoutingRule) {
    setDraft({ id: rule.id, name: rule.name, isActive: rule.isActive, order: String(rule.order),
      issueType: rule.match.issueType ?? "", urgency: rule.match.urgency ?? "", source: rule.match.source ?? "",
      priority: rule.action.priority ?? "", teamId: rule.action.teamId ?? "", slaMinutes: rule.action.slaMinutes === undefined ? "" : String(rule.action.slaMinutes) });
    setDeleting(null); setError(false); setMessage(`Editing “${rule.name}”. Changes are not applied until you save.`);
  }

  return <section className="surface-card p-6" aria-labelledby="routing-policy-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="section-kicker">Software routing</p><h2 id="routing-policy-heading" className="text-balance text-lg font-semibold">Routing rules</h2></div>
      <button type="button" disabled={busy} onClick={() => void refresh()} className={`btn-soft ${buttonClass}`}>Refresh rules</button>
    </div>
    <p className="mt-3 max-w-3xl text-pretty text-sm text-ink-muted">Jev assesses the ticket; these rules choose a workspace team, priority, and response deadline. Low-confidence and human-triage cases stay with a person. Source-system changes require separate writeback approval.</p>
    <p className={`mt-3 text-sm ${error ? "text-red-700" : "text-ink-muted"}`} role={error ? "alert" : "status"} aria-live="polite">{message}</p>

    {data && <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div>
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Evaluation order</h3><span className="text-xs tabular-nums text-ink-muted">{data.rules.filter(rule => rule.isActive).length} active · {data.rules.length} total</span></div>
        <p className="mt-1 text-xs text-ink-muted">Lower order values run first. Ties use creation time, then rule ID.</p>
        <div className="mt-4 divide-y divide-border">
          {data.rules.length === 0 && <div className="surface-inset p-5 text-sm text-ink-muted">No custom rules yet. Existing Jev routing defaults remain in effect.</div>}
          {data.rules.map(rule => <article key={rule.id} className="py-4 first:pt-0">
            <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{rule.name}</h4><p className="mt-1 text-xs tabular-nums text-ink-muted">Order {rule.order} · {rule.isActive ? "Active" : "Paused"}</p></div>
              <button type="button" disabled={busy} onClick={() => void mutate("PATCH", { id: rule.id, isActive: !rule.isActive }, `${rule.name} ${rule.isActive ? "paused" : "enabled"}.`)} className={`btn-soft ${buttonClass}`}>{rule.isActive ? "Pause" : "Enable"}</button></div>
            <p className="mt-3 text-pretty text-sm text-ink-muted"><span className="font-semibold text-ink">When </span>{Object.entries(rule.match).map(([key, value]) => `${label(key === "issueType" ? "issue_type" : key)}: ${label(value)}`).join(" · ") || "any confidently classified ticket"}</p>
            <p className="mt-1 text-pretty text-sm text-ink-muted"><span className="font-semibold text-ink">Then </span>{[
              rule.action.priority ? `priority ${rule.action.priority}` : null,
              rule.action.teamId ? `team ${data.teams.find(team => team.id === rule.action.teamId)?.name ?? "unavailable (rule is skipped)"}` : null,
              rule.action.slaMinutes ? `respond within ${rule.action.slaMinutes} minutes` : null,
            ].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => edit(rule)} className={`btn-soft ${buttonClass}`}>Edit</button>
              {deleting === rule.id ? <><button type="button" disabled={busy} className={`btn-soft text-red-700 ${buttonClass}`} onClick={() => void mutate("DELETE", { id: rule.id }, "Rule deleted. Its audit history is retained.")}>Confirm deletion</button><button type="button" disabled={busy} className={`btn-soft ${buttonClass}`} onClick={() => setDeleting(null)}>Cancel</button></>
                : <button type="button" disabled={busy} className={`btn-soft text-red-700 ${buttonClass}`} onClick={() => setDeleting(rule.id)}>Delete</button>}
            </div>
          </article>)}
        </div>
      </div>

      <form onSubmit={save} className="surface-inset p-5">
        <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
          <legend className="mb-4 text-base font-semibold">{draft.id ? "Edit rule" : "Add a rule"}</legend>
          <label className={labelClass}>Rule name<input className={fieldClass} required maxLength={120} value={draft.name} onChange={event => change("name", event.target.value)} placeholder="Security issues to security team" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>Order<input type="number" min={0} max={100000} step={1} required className={`${fieldClass} tabular-nums`} value={draft.order} onChange={event => change("order", event.target.value)} /></label>
            <label className={labelClass}>State<select className={fieldClass} value={draft.isActive ? "active" : "paused"} onChange={event => change("isActive", event.target.value === "active")}><option value="active">Active</option><option value="paused">Paused</option></select></label>
          </div>
          <div className="border-t border-border pt-4"><h4 className="mb-3 text-sm font-semibold">Match all selected conditions</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Issue type<select className={fieldClass} value={draft.issueType} onChange={event => change("issueType", event.target.value)}><option value="">Any issue</option>{issues.map(issue => <option key={issue} value={issue}>{label(issue)}</option>)}</select></label>
              <label className={labelClass}>Urgency<select className={fieldClass} value={draft.urgency} onChange={event => change("urgency", event.target.value)}><option value="">Any urgency</option>{["critical", "high", "normal", "low"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className={`${labelClass} sm:col-span-2`}>Source (optional)<input className={fieldClass} maxLength={80} list="routing-source-options" value={draft.source} onChange={event => change("source", event.target.value)} placeholder="Any source" /><datalist id="routing-source-options">{["repairshopr", "syncro", "manual", "alert_email"].map(value => <option key={value} value={value} />)}</datalist></label>
            </div>
          </div>
          <div className="border-t border-border pt-4"><h4 className="mb-3 text-sm font-semibold">Apply these actions</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Priority<select className={fieldClass} value={draft.priority} onChange={event => change("priority", event.target.value)}><option value="">Keep default</option>{["P1", "P2", "P3", "P4"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className={labelClass}>Response deadline (minutes)<input className={`${fieldClass} tabular-nums`} type="number" min={1} max={43200} step={1} value={draft.slaMinutes} onChange={event => change("slaMinutes", event.target.value)} placeholder="Keep default" /></label>
              <label className={`${labelClass} sm:col-span-2`}>Workspace team<select className={fieldClass} value={draft.teamId} onChange={event => change("teamId", event.target.value)}><option value="">Keep suggested team</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            </div>
            <p className="mt-2 text-xs text-ink-muted">Choose at least one action. Existing ticket deadlines and manual assignments are protected by the workflow.</p>
          </div>
          <div className="flex flex-wrap gap-2"><button type="submit" className={`btn-primary ${buttonClass}`}>{busy ? "Saving…" : draft.id ? "Save changes" : "Create rule"}</button>
            {draft.id && <button type="button" className={`btn-soft ${buttonClass}`} onClick={() => setDraft(freshDraft())}>Cancel edit</button>}</div>
        </fieldset>
      </form>
    </div>}
  </section>;
}
