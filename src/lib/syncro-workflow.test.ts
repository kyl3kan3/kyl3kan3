import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { bindSyncroAccount, commentEvidence, externalId, fetchSyncroHistory, mapSyncroUser, runSyncroImportBatch } from "./syncro-workflow";

test("source evidence distinguishes staff, public replies, and unknown actors", () => {
  assert.equal(externalId("../users"), null);
  assert.equal(commentEvidence({id:1,created_at:"bad",body:"test"}),null);
  const comment={id:1,created_at:"2026-09-01T10:00:00Z",body:"Restarted and verified",user_id:8};
  assert.equal(commentEvidence({...comment,hidden:false})?.action,"customer-facing technician message");
  assert.equal(commentEvidence({...comment,hidden:true})?.action,"internal technician note");
  assert.equal(commentEvidence({...comment,user_id:null})?.actor,"customer or unattributed participant");
});

test("loads all comment pages and refuses malformed histories",async () => {
  const pages:number[]=[];
  const history=await fetchSyncroHistory("5",async (_path,params) => {
    const page=Number(params.page); pages.push(page);
    return {comments:[{id:page,created_at:`2026-09-0${page}T10:00:00Z`,body:`Note ${page}`,user_id:1}],meta:{total_pages:2}};
  });
  assert.deepEqual(pages,[1,2]); assert.equal(history.length,2);
  await assert.rejects(fetchSyncroHistory("5",async()=>({error:"access denied"})),/missing comments/);
  await assert.rejects(fetchSyncroHistory("5",async()=>({comments:[],meta:{page:1,total_pages:2}})),/ended unexpectedly/);
  await assert.rejects(fetchSyncroHistory("5",async()=>({comments:[],meta:{page:2,total_pages:2}})),/did not advance/);
  await assert.rejects(fetchSyncroHistory("../users",async()=>({comments:[]})),/Invalid Syncro ticket ID/);
});

test("durable import checkpoints survive ticket failures and retry without losing work",async (t) => {
  const db=new PGlite();
  const schema=(await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;","");
  await db.exec(schema);
  const org="11111111-1111-4111-8111-111111111111";
  await db.query("insert into orgs(id,name) values($1,'Queue test')",[org]);
  const previous=process.env.DATABASE_URL;
  const fetchBefore=neonConfig.fetchFunction;
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";
  t.after(async()=>{neonConfig.fetchFunction=fetchBefore; if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous; await db.close();});
  neonConfig.fetchFunction=async (_url: Parameters<typeof fetch>[0],init?: RequestInit) => {
    const body=JSON.parse(String(init?.body));
    const execute=async(q:{query:string;params:unknown[]})=>{
      const result=await db.query<Record<string,unknown>>(q.query,q.params);
      return {fields:result.fields, rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];
        return value===null ? null : value instanceof Date ? value.toISOString() : typeof value==="object" ? JSON.stringify(value) : String(value);
      })), rowCount:result.affectedRows ?? result.rows.length};
    };
    try {
      if(body.queries){ await db.exec("begin");try {const results=[]; for(const query of body.queries)results.push(await execute(query));await db.exec("commit");return Response.json({results});}catch(error){await db.exec("rollback");throw error;} }
      return Response.json(await execute(body));
    } catch(error){ return Response.json({message:error instanceof Error?error.message:"query failed"},{status:400}); }
  };
  let fail=true, imported=0, revision="2026-09-01";
  const input={orgId:org,renew:async()=>{},customer:async()=>{},ticket:async()=>{if(fail)throw new Error("temporary");imported++;},
    fetcher:async(path:string)=>path==="/customers"?{customers:[],meta:{total_pages:1}}:path==="/tickets"?{tickets:[{id:1,updated_at:revision}],meta:{total_pages:1}}:{ticket:{id:1}}};
  await runSyncroImportBatch(input);
  const failed=await runSyncroImportBatch(input);
  assert.equal(failed.failedTickets,1);assert.equal(failed.pendingTickets,1);
  assert.equal((await db.query<{phase:string}>("select phase from syncro_import_state")).rows[0].phase,"customers");
  await db.exec("update syncro_import_queue set retry_at=null");fail=false;
  const recovered=await runSyncroImportBatch(input);
  assert.equal(recovered.pendingTickets,0);assert.equal(imported,1);
  await runSyncroImportBatch(input);
  assert.equal(imported,1,"unchanged ticket payload must not be reprocessed");
  revision="2026-09-02";
  await runSyncroImportBatch(input);await runSyncroImportBatch(input);
  assert.equal(imported,2,"changed ticket payload must be reimported");
  const stateBefore=(await db.query<{phase:string}>("select phase from syncro_import_state where org_id=$1",[org])).rows[0].phase;
  await assert.rejects(runSyncroImportBatch({...input,fetcher:async()=>({error:"forbidden"})}),/malformed/);
  assert.equal((await db.query<{phase:string}>("select phase from syncro_import_state where org_id=$1",[org])).rows[0].phase,stateBefore,"failed discovery must not advance its checkpoint");
  const mapped=await mapSyncroUser(org,7,async()=>({user:{id:7,full_name:"Same Name",admin:true}}));
  const same=await mapSyncroUser(org,7,async()=>{throw new Error("existing identity should not require another lookup");});
  const distinct=await mapSyncroUser(org,8,async()=>({user:{id:8,full_name:"Same Name"}}));
  assert.equal(mapped,same);assert.notEqual(mapped,distinct,"matching names must not merge different technicians");
  await assert.rejects(mapSyncroUser(org,9,async()=>({user:{id:10,full_name:"Wrong identity"}})),/does not match/);
  const envKeys=["SYNCRO_SUBDOMAIN","SYNCRO_API_KEY"];
  const envBefore=envKeys.map(key=>process.env[key]);
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;envKeys.forEach((key,i)=>{if(envBefore[i]===undefined)delete process.env[key];else process.env[key]=envBefore[i];});});
  process.env.SYNCRO_SUBDOMAIN="test";process.env.SYNCRO_API_KEY="test";
  let status="New", sourceId=9;
  globalThis.fetch=(async(url)=>{
    const pathname=new URL(String(url)).pathname;
    const ticket={id:sourceId,subject:"VPN broken",status,user_id:8,created_at:"2026-09-01T10:00:00Z",updated_at:status==="New"?"2026-09-01T10:00:00Z":"2026-09-02T10:00:00Z",resolved_at:status==="New"?null:"2026-09-02T10:00:00Z"};
    if(pathname.endsWith("/customers"))return Response.json({customers:[],meta:{total_pages:1}});
    if(pathname.endsWith("/users"))return Response.json({users:[{id:8,full_name:"Verified Technician"}],meta:{total_pages:1}});
    if(pathname.endsWith("/tickets"))return Response.json({tickets:[ticket],meta:{total_pages:1}});
    if(pathname.endsWith("/comments"))return Response.json({comments:[
      {id:90,body:"Restarted VPN and verified connection; customer can reconnect now",created_at:"2026-09-02T09:00:00Z",user_id:8,hidden:false},
      {id:91,body:"Future cycle note must not leak into earlier reviews",created_at:"2027-09-02T09:00:00Z",user_id:8,hidden:false},
    ],meta:{total_pages:1}});
    if(pathname.endsWith("/users/8"))return Response.json({user:{id:8,full_name:"Verified Technician",admin:true}});
    return Response.json({ticket});
  }) as typeof fetch;
  const {syncSyncro}=await import("./syncro");
  await syncSyncro();await syncSyncro();
  const first=(await db.query<{id:string;role:string}>("select t.id,u.role from tickets t join users u on u.id=t.assigned_user_id where syncro_ticket_id='9'")).rows[0];
  assert.equal(first.role,"agent","upstream admin must not grant local admin");
  await db.query("insert into ticket_comments(ticket_id,body,created_via,created_at) values ($1,'Future local note must not leak','ui','2027-01-01')",[first.id]);
  await db.query("insert into ticket_status_events(org_id,ticket_id,from_status,to_status,completion_cycle,source,changed_at) select org_id,id,'assigned','waiting',0,'ui','2027-01-01' from tickets where id=$1",[first.id]);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from provider_user_links where provider='syncro' and org_id=(select id from orgs where name='Default Operations')")).rows[0].count,1);
  await assert.rejects(bindSyncroAccount((await db.query<{id:string}>("select id from orgs where name='Default Operations'")).rows[0].id,"other-account"),/account changed/);
  status="Resolved";await syncSyncro();const completed=await syncSyncro();
  assert.equal(completed.ticketsSynced,1);
  const review=(await db.query<{evaluated_user_id:string;input_snapshot:{input:{history:unknown[]}}}>("select evaluated_user_id,input_snapshot from jev_assessments where kind='completion_review'")).rows[0];
  assert.ok(review.evaluated_user_id);assert.ok(JSON.stringify(review.input_snapshot.input.history).includes("Restarted VPN"));
  assert.equal(JSON.stringify(review.input_snapshot.input.history).includes("Future cycle note"),false);
  assert.equal(JSON.stringify(review.input_snapshot.input.history).includes("Future local note"),false);
  assert.equal(JSON.stringify(review.input_snapshot.input.history).includes("Status changed from assigned to waiting"),false);
  await syncSyncro();await syncSyncro();
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_completion_submissions")).rows[0].count,1);
  status="In Progress";await syncSyncro();await syncSyncro();
  const reopened=(await db.query<{status:string;completion_cycle:number;reopened_count:number;resolved_at:null}>("select status,completion_cycle,reopened_count,resolved_at from tickets where syncro_ticket_id='9'")).rows[0];
  assert.equal(reopened.status,"in_progress");assert.equal(reopened.reopened_count,1);assert.equal(reopened.completion_cycle,1);assert.equal(reopened.resolved_at,null);
  status="Resolved";await syncSyncro();await syncSyncro();
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_completion_submissions")).rows[0].count,2,"re-completion must create exactly one new review cycle");
  sourceId=10;
  await db.exec("insert into tickets(org_id,title,status,priority,created_from,syncro_ticket_id,created_at) select id,'Legacy completed import','resolved','P3','syncro','10','2026-09-01' from orgs where name='Default Operations'");
  await syncSyncro();await syncSyncro();
  const historical=(await db.query<{completion_cycle:number;evaluated_user_id:string|null}>("select a.completion_cycle,a.evaluated_user_id from jev_assessments a join tickets t on t.id=a.ticket_id where t.syncro_ticket_id='10' and a.kind='completion_review'")).rows[0];
  assert.equal(historical.completion_cycle,1,"legacy completed tickets need a real completion cycle");
  assert.equal(historical.evaluated_user_id,null,"historical ownership is not evidence of who completed the work");
});
