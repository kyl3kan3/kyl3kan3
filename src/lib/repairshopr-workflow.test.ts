import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { commentEvidence, externalId, fetchRepairShoprHistory, runRepairShoprImportBatch } from "./repairshopr-workflow";

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
  const history=await fetchRepairShoprHistory("5",async (_path,params) => {
    const page=Number(params.page); pages.push(page);
    return {comments:[{id:page,created_at:`2026-09-0${page}T10:00:00Z`,body:`Note ${page}`,user_id:1}],meta:{total_pages:2}};
  });
  assert.deepEqual(pages,[1,2]); assert.equal(history.length,2);
  await assert.rejects(fetchRepairShoprHistory("5",async()=>({error:"access denied"})),/missing comments/);
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
  let fail=true, imported=0;
  const input={orgId:org,renew:async()=>{},customer:async()=>{},ticket:async()=>{if(fail)throw new Error("temporary");imported++;},
    fetcher:async(path:string)=>path==="/customers"?{customers:[],meta:{total_pages:1}}:path==="/tickets"?{tickets:[{id:1,updated_at:"2026-09-01"}],meta:{total_pages:1}}:{ticket:{id:1}}};
  await runRepairShoprImportBatch(input);
  const failed=await runRepairShoprImportBatch(input);
  assert.equal(failed.failedTickets,1);assert.equal(failed.pendingTickets,1);
  assert.equal((await db.query<{phase:string}>("select phase from repairshopr_import_state")).rows[0].phase,"customers");
  await db.exec("update repairshopr_import_queue set retry_at=null");fail=false;
  const recovered=await runRepairShoprImportBatch(input);
  assert.equal(recovered.pendingTickets,0);assert.equal(imported,1);
  await runRepairShoprImportBatch(input);
  assert.equal(imported,1,"unchanged ticket payload must not be reprocessed");
  const envKeys=["REPAIRSHOPR_SUBDOMAIN","REPAIRSHOPR_API_KEY"];
  const envBefore=envKeys.map(key=>process.env[key]);
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;envKeys.forEach((key,i)=>{if(envBefore[i]===undefined)delete process.env[key];else process.env[key]=envBefore[i];});});
  process.env.REPAIRSHOPR_SUBDOMAIN="test";process.env.REPAIRSHOPR_API_KEY="test";
  let status="New";
  globalThis.fetch=(async(url)=>{
    const pathname=new URL(String(url)).pathname;
    const ticket={id:9,subject:"VPN broken",status,user_id:8,created_at:"2026-09-01T10:00:00Z",updated_at:status==="New"?"2026-09-01T10:00:00Z":"2026-09-02T10:00:00Z",resolved_at:status==="New"?null:"2026-09-02T10:00:00Z"};
    if(pathname.endsWith("/customers"))return Response.json({customers:[],meta:{total_pages:1}});
    if(pathname.endsWith("/tickets"))return Response.json({tickets:[ticket],meta:{total_pages:1}});
    if(pathname.endsWith("/comments"))return Response.json({comments:[{id:90,body:"Restarted VPN and verified connection; customer can reconnect now",created_at:"2026-09-02T09:00:00Z",user_id:8,hidden:false}],meta:{total_pages:1}});
    if(pathname.endsWith("/users/8"))return Response.json({user:{id:8,full_name:"Verified Technician",admin:true}});
    return Response.json({ticket});
  }) as typeof fetch;
  const {syncRepairShopr}=await import("./repairshopr");
  await syncRepairShopr();await syncRepairShopr();
  const first=(await db.query<{id:string;role:string}>("select t.id,u.role from tickets t join users u on u.id=t.assigned_user_id where repairshopr_ticket_id='9'")).rows[0];
  assert.equal(first.role,"agent","upstream admin must not grant local admin");
  status="Resolved";await syncRepairShopr();const completed=await syncRepairShopr();
  assert.equal(completed.ticketsSynced,1);
  const review=(await db.query<{evaluated_user_id:string;input_snapshot:{input:{history:unknown[]}}}>("select evaluated_user_id,input_snapshot from jev_assessments where kind='completion_review'")).rows[0];
  assert.ok(review.evaluated_user_id);assert.ok(JSON.stringify(review.input_snapshot.input.history).includes("Restarted VPN"));
  await syncRepairShopr();await syncRepairShopr();
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_completion_submissions")).rows[0].count,1);
});
