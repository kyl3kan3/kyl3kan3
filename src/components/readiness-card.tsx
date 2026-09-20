"use client";
import { useState } from "react";

export function ReadinessCard(){
  const [output,setOutput]=useState("Check deployment configuration, import backlog, and live provider access. Manager authentication is required.");
  const [busy,setBusy]=useState(false);
  async function check(live:boolean){
    setBusy(true);
    try{
      const response=await fetch("/api/readiness",{method:live?"POST":"GET",cache:"no-store"});
      if(!response.ok)throw new Error(response.status===401?"Sign in with the manager account to run readiness checks.":"Readiness check could not complete.");
      const data=await response.json();
      setOutput(live?`Jev: ${data.jev.status}${data.jev.error ? ` (${data.jev.error})` : ""}. RepairShopr: ${data.repairshopr}.`:
        `${Object.entries(data.checks).map(([key,value])=>`${key}: ${value?"ready":"missing"}`).join(" · ")}\nPending imports: ${data.backlog?.pending ?? 0}. Failed imports awaiting retry: ${data.backlog?.failed ?? 0}.`);
    }catch(error){setOutput(error instanceof Error?error.message:"Readiness check failed");}finally{setBusy(false);}
  }
  return <section className="rounded-xl border border-border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-ink">Production readiness</h2>
    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-muted" role="status">{busy?"Checking…":output}</p>
    <div className="mt-3 flex gap-2"><button className="btn-soft rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={()=>check(false)}>Check setup</button>
    <button className="btn-primary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={()=>check(true)}>Test live connections</button></div>
    <p className="mt-3 text-xs text-ink-muted">Live testing sends a synthetic sample to Jev. RepairShopr imports run in resumable batches; an initial backlog can take multiple scheduled runs.</p></section>;
}
