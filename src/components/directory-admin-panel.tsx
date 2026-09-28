"use client";
import { useEffect, useState } from "react";
import type { DirectoryData, DirectoryUser } from "@/lib/directory";

type Draft={fullName:string;role:DirectoryUser["role"];teamId:string;isActive:boolean;isOnCall:boolean};
const control="input-field h-11 w-full rounded-lg px-3 text-sm";
const button="btn-soft min-h-11 rounded-lg px-4 text-sm font-semibold transition-transform active:scale-[0.96] motion-reduce:transition-none disabled:opacity-50";

export function DirectoryAdminPanel() {
  const [data,setData]=useState<DirectoryData|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [search,setSearch]=useState("");
  const [showInactive,setShowInactive]=useState(false);
  const [pending,setPending]=useState(false);
  const [notice,setNotice]=useState("");
  async function load() {
    const response=await fetch("/api/directory",{cache:"no-store"});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || "Manager sign-in is required");
    setData(result);
  }
  useEffect(()=>{
    let active=true;
    fetch("/api/directory",{cache:"no-store"}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error || "Unable to load directory");
      if(active)setData(result);
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"Unable to load directory");});
    return()=>{active=false;};
  },[]);
  function edit(user:DirectoryUser) {
    setSelected(user.id);
    setDraft({fullName:user.fullName ?? "",role:user.role,teamId:user.teamIds[0] ?? "",isActive:user.isActive,isOnCall:user.isOnCall});
    setNotice("");
  }
  async function save() {
    if(!selected || !draft)return;
    setPending(true);setNotice("");
    try {
      const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:selected,...draft,teamId:draft.teamId || null})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || "Unable to save user");
      await load();setSelected(null);setDraft(null);
      setNotice("Directory updated. Existing ticket ownership and history are preserved.");
    } catch(error) {setNotice(error instanceof Error?error.message:"Unable to save user");}
    finally {setPending(false);}
  }
  const users=data?.users.filter(user=>(showInactive || user.isActive) && ((user.fullName ?? "")+" "+user.email).toLowerCase().includes(search.toLowerCase())) ?? [];
  const current=data?.users.find(user=>user.id===selected);
  return <section className="surface-card rounded-3xl p-6" aria-labelledby="directory-admin-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="directory-admin-title" className="text-balance text-lg font-semibold text-ink">Manage existing staff</h2>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-ink-muted">Edit team, reporting role, and on-call availability. Deactivation stops future automatic assignment; existing tickets and source identities stay intact.</p></div>
      <button className={button} type="button" disabled={pending} onClick={()=>{setPending(true);void load().catch(error=>setNotice(error.message)).finally(()=>setPending(false));}}>Refresh directory</button>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <label className="grid flex-1 gap-1 text-sm"><span>Find a staff member</span><input className={control} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name or identity email" /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={event=>setShowInactive(event.target.checked)} />Include inactive</label>
      <span className="tabular-nums text-sm text-ink-muted">{users.length} shown</span>
    </div>
    {!data && !notice ? <p className="mt-4 text-sm text-ink-muted">Loading directory…</p> : null}
    <div className="mt-4 divide-y divide-black/5">
      {users.map(user=><div key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="font-medium text-ink">{user.fullName || user.email} <span className="ml-2 text-xs font-normal text-ink-muted">{user.isActive ? "Active" : "Inactive"} · {user.role}</span></p>
          <p className="break-all text-sm text-ink-muted">{user.email}{user.importedIdentity ? " · Source-linked identity" : ""}</p></div>
        <button type="button" className={button} disabled={pending} onClick={()=>edit(user)} aria-label={"Edit "+(user.fullName || user.email)}>Edit</button>
      </div>)}
      {data && !users.length ? <p className="py-5 text-sm text-ink-muted">No staff match this view.</p> : null}
    </div>
    {draft && current ? <form className="surface-inset mt-5 rounded-2xl p-4" onSubmit={event=>{event.preventDefault();void save();}}>
      <h3 className="text-balance font-semibold text-ink">Edit {current.fullName || current.email}</h3>
      <p className="mt-1 break-all text-sm text-ink-muted">Identity email is preserved: {current.email}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">Display name<input className={control} maxLength={160} value={draft.fullName} onChange={event=>setDraft({...draft,fullName:event.target.value})} disabled={pending} /></label>
        <label className="grid gap-1 text-sm">Reporting role<select className={control} value={draft.role} onChange={event=>setDraft({...draft,role:event.target.value as Draft["role"]})} disabled={pending}>
          {["reporter","agent","manager","admin"].map(role=><option key={role} value={role}>{role}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Team<select className={control} value={draft.teamId} onChange={event=>setDraft({...draft,teamId:event.target.value})} disabled={pending}>
          <option value="">No team</option>{data?.teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={event=>setDraft({...draft,isActive:event.target.checked})} disabled={pending} />Active for future assignments</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.isOnCall} onChange={event=>setDraft({...draft,isOnCall:event.target.checked})} disabled={pending} />On call</label>
      </div>
      <p className="text-pretty text-xs text-ink-muted">Reporting roles do not create personal login accounts. Reporters and inactive staff are excluded from automatic assignment.</p>
      <div className="mt-4 flex gap-3"><button className="btn-primary min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
        <button type="button" className={button} disabled={pending} onClick={()=>{setSelected(null);setDraft(null);}}>Cancel</button></div>
    </form> : null}
    {notice ? <p role="status" className="mt-4 text-pretty text-sm text-ink-muted">{notice}</p> : null}
  </section>;
}
