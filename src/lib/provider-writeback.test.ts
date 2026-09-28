import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import {
  approveProviderWriteback, compareProviderWriteback, enqueueRoutingWriteback,
  getProviderWritebackConfig, getProviderWritebackStatus, listProviderWritebacks,
  processProviderWritebacks, reconcileProviderWritebacks, retryProviderWriteback,
} from "./provider-writeback";

test("baseline comparison refuses changed source and recognizes an already applied retry", () => {
  const baseline = { updated_at:"2026-09-01T00:00:00.000Z", priority:"Normal", user_id:null, status:"New" };
  assert.equal(compareProviderWriteback(baseline,baseline,{priority:"High"}),"safe_to_apply");
  assert.equal(compareProviderWriteback({...baseline,updated_at:"2026-09-02"},baseline,{priority:"High"}),"conflict");
  assert.equal(compareProviderWriteback({...baseline,user_id:12},baseline,{priority:"High"}),"conflict");
  assert.equal(compareProviderWriteback({...baseline,status:"Resolved"},baseline,{priority:"High"}),"conflict");
  assert.equal(compareProviderWriteback({...baseline,priority:"High",user_id:12,updated_at:"2026-09-02"},baseline,{priority:"High",user_id:12}),"already_applied");
  assert.equal(compareProviderWriteback(baseline,{...baseline,updated_at:null},{priority:"High"}),"conflict");
  assert.equal(compareProviderWriteback({...baseline,status:"Resolved"},{...baseline,status:"Resolved"},{priority:"High"}),"conflict");
});

test("durable provider writebacks require approval, mappings, account identity and conflict-safe retries", async t => {
  const db = new PGlite();
  const ddl = (await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;","");
  await db.exec(ddl);
  const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID();
  await db.query("insert into orgs(id,name) values($1,'Writeback test'),($2,'Other org')",[org,otherOrg]);
  await db.query("insert into users(id,org_id,email,full_name,role) values($1,$2,'writeback@test.invalid','Technician','agent')",[user,org]);
  await db.exec("alter table tickets add column if not exists repairshopr_ticket_id text; alter table tickets add column if not exists repairshopr_updated_at timestamptz; alter table tickets add column if not exists repairshopr_payload jsonb; alter table tickets add column if not exists syncro_ticket_id text; alter table tickets add column if not exists syncro_updated_at timestamptz; alter table tickets add column if not exists syncro_payload jsonb;");
  await db.exec("create table repairshopr_account_binding(org_id uuid primary key,subdomain text); create table syncro_account_binding(org_id uuid primary key,subdomain text)");
  await db.query("insert into repairshopr_account_binding values($1,'test')",[org]);
  await db.query("insert into syncro_account_binding values($1,'test')",[org]);
  const envKeys = ["DATABASE_URL","NODE_ENV","MANAGER_DASHBOARD_PASSWORD",... ["REPAIRSHOPR","SYNCRO"].flatMap(prefix => ["SUBDOMAIN","API_KEY","WRITEBACK_ENABLED","WRITEBACK_AUTO_APPROVE","WRITEBACK_PRIORITY_MAP"].map(suffix=>`${prefix}_${suffix}`))];
  const before = Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const dbFetch = neonConfig.fetchFunction, networkFetch = globalThis.fetch;
  t.after(async()=>{ globalThis.fetch=networkFetch; neonConfig.fetchFunction=dbFetch; for(const key of envKeys){ if(before[key]===undefined) delete process.env[key]; else process.env[key]=before[key]; } await db.close(); });
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";
  Object.assign(process.env,{NODE_ENV:"test"});
  for (const prefix of ["REPAIRSHOPR","SYNCRO"]) {
    process.env[`${prefix}_SUBDOMAIN`]="test"; process.env[`${prefix}_API_KEY`]="secret-test-value";
    process.env[`${prefix}_WRITEBACK_PRIORITY_MAP`]=JSON.stringify({P1:"Urgent",P2:"High",P3:"Normal",P4:"Low"});
    delete process.env[`${prefix}_WRITEBACK_ENABLED`]; delete process.env[`${prefix}_WRITEBACK_AUTO_APPROVE`];
  }
  neonConfig.fetchFunction=async (_url: Parameters<typeof fetch>[0],init?: RequestInit) => {
    const query=JSON.parse(String(init?.body));
    try {
      const result=await db.query<Record<string,unknown>>(query.query,query.params);
      return Response.json({fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];return value===null?null:value instanceof Date?value.toISOString():typeof value==="object"?JSON.stringify(value):String(value);
      })),rowCount:result.affectedRows??result.rows.length});
    } catch(error){return Response.json({message:error instanceof Error?error.message:"query failed"},{status:400});}
  };
  let nextId=10, puts=0, reads=0, timeoutAfterPut=false, responseStatus=200;
  const remote = new Map<string,Record<string,unknown>>();
  globalThis.fetch=(async(input,init)=>{
    const url=new URL(String(input)), external=url.pathname.split("/").at(-1)!;
    assert.equal(url.search, "", "API tokens never travel in URLs");
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer secret-test-value");
    assert.equal(init?.redirect,"error");
    if(init?.method==="PUT"){
      puts++;
      const body=JSON.parse(String(init.body));
      assert.deepEqual(Object.keys(body).sort(),body.user_id ? ["priority","user_id"] : ["priority"]);
      if(responseStatus!==200)return Response.json({error:"redacted upstream"},{status:responseStatus});
      remote.set(external,{...remote.get(external),...body,updated_at:"2026-09-02T00:00:00Z"});
      if(timeoutAfterPut){timeoutAfterPut=false;throw new Error("ambiguous timeout secret-test-value");}
    } else reads++;
    return Response.json({ticket:remote.get(external)});
  }) as typeof fetch;
  const make=async(provider:"repairshopr"|"syncro"="repairshopr",needsHuman=false)=>{
    const ticketId=randomUUID(),assessmentId=randomUUID(),external=String(nextId++);
    const source={id:Number(external),updated_at:"2026-09-01T00:00:00Z",priority:"Normal",user_id:null,status:"New"};
    remote.set(external,source);
    await db.query(`insert into tickets(id,org_id,title,status,priority,created_from,triage_needs_human,${provider}_ticket_id,${provider}_updated_at,${provider}_payload) values($1,$2,'VPN down','new','P3',$3,$4,$5,$6,$7)`,[ticketId,org,provider,needsHuman,external,source.updated_at,JSON.stringify(source)]);
    await db.query("insert into jev_assessments(id,org_id,ticket_id,kind,status,idempotency_key,result) values($1,$2,$3,'triage','succeeded',$5,$4)",[assessmentId,org,ticketId,JSON.stringify({assessment:{needsHumanTriage:needsHuman},routing:{needsHumanTriage:needsHuman,routingApplied:true}}),assessmentId]);
    return {orgId:org,ticketId,assessmentId,external};
  };
  const queued=async(input:Awaited<ReturnType<typeof make>>,assignedUserId?:string)=>{
    const result=await enqueueRoutingWriteback({...input,proposal:{priority:"P2",assignedUserId}});
    assert.equal(result.queued,true);assert.ok(result.id);return result.id;
  };
  const state=async(queueId:string)=>(await db.query<{status:string;last_error:string;attempts:number}>("select status,last_error,attempts from provider_writebacks where id=$1",[queueId])).rows[0];

  await t.test("disabled defaults never perform network writes and repeated enqueue is idempotent",async()=>{
    const input=await make(), queueId=await queued(input);
    assert.equal((await state(queueId)).status,"awaiting_approval");
    assert.equal(await queued(input),queueId);
    await assert.rejects(approveProviderWriteback(org,queueId),/writeback_disabled/);
    assert.equal((await processProviderWritebacks({orgId:org})).processed,0);assert.equal(reads,0);assert.equal(puts,0);
    process.env.REPAIRSHOPR_WRITEBACK_ENABLED="true";
    await approveProviderWriteback(org,queueId);
    assert.equal((await processProviderWritebacks({orgId:org})).succeeded,1);
    assert.equal(puts,1);assert.equal((await state(queueId)).status,"succeeded");
    assert.equal((await processProviderWritebacks({orgId:org})).processed,0);
  });
  await t.test("missing mappings are visible and require manager approval after repair",async()=>{
    delete process.env.REPAIRSHOPR_WRITEBACK_PRIORITY_MAP;
    const input=await make(), queueId=await queued(input);
    assert.equal((await state(queueId)).status,"blocked");
    assert.match((await state(queueId)).last_error,/missing_priority_mapping/);
    process.env.REPAIRSHOPR_WRITEBACK_PRIORITY_MAP=JSON.stringify({P2:"High"});
    await retryProviderWriteback(org,queueId);
    assert.equal((await state(queueId)).status,"awaiting_approval");
    await approveProviderWriteback(org,queueId);await processProviderWritebacks({orgId:org});
    assert.equal((await state(queueId)).status,"succeeded");
  });
  await t.test("explicit source identity mapping is required for technician assignment",async()=>{
    const input=await make(), queueId=await queued(input,user);
    assert.equal((await state(queueId)).status,"blocked");
    assert.match((await state(queueId)).last_error,/technician_mapping/);
    await db.query("insert into provider_user_links(org_id,provider,external_id,user_id) values($1,'repairshopr','42',$2)",[org,user]);
    await approveProviderWriteback(org,queueId);await processProviderWritebacks({orgId:org});
    assert.equal(remote.get(input.external)?.user_id,42);
  });
  await t.test("remote concurrent changes block writes and cannot be retried over the newer source",async()=>{
    const input=await make(), queueId=await queued(input), count=puts;
    await approveProviderWriteback(org,queueId);
    remote.set(input.external,{...remote.get(input.external),user_id:999,updated_at:"2026-09-03"});
    await processProviderWritebacks({orgId:org});
    assert.equal((await state(queueId)).status,"conflict");assert.equal(puts,count);
    await assert.rejects(retryProviderWriteback(org,queueId),/retriage/);
  });
  await t.test("ambiguous successful PUT is reconciled by GET without duplicate mutation",async()=>{
    const input=await make(), queueId=await queued(input), count=puts;
    await approveProviderWriteback(org,queueId);timeoutAfterPut=true;
    await processProviderWritebacks({orgId:org});assert.equal((await state(queueId)).status,"retryable");
    assert.equal((await state(queueId)).last_error,"provider_network_error");
    await db.query("update provider_writebacks set next_retry_at=null where id=$1",[queueId]);
    await processProviderWritebacks({orgId:org});assert.equal((await state(queueId)).status,"succeeded");assert.equal(puts,count+1);
  });
  await t.test("permanent permission errors fail while rate limits retry",async()=>{
    const first=await queued(await make());await approveProviderWriteback(org,first);responseStatus=403;
    await processProviderWritebacks({orgId:org});assert.equal((await state(first)).status,"failed");
    const second=await queued(await make());await approveProviderWriteback(org,second);responseStatus=429;
    await processProviderWritebacks({orgId:org});assert.equal((await state(second)).status,"retryable");
    responseStatus=200;await retryProviderWriteback(org,second);await approveProviderWriteback(org,second);await processProviderWritebacks({orgId:org});
  });
  await t.test("source account changes and local manager edits prevent stale routing",async()=>{
    const input=await make(), queueId=await queued(input), count=puts;
    process.env.REPAIRSHOPR_SUBDOMAIN="different";
    await assert.rejects(approveProviderWriteback(org,queueId),/account_changed/);
    process.env.REPAIRSHOPR_SUBDOMAIN="test";
    await approveProviderWriteback(org,queueId);
    await db.query("update tickets set priority='P1' where id=$1",[input.ticketId]);
    await processProviderWritebacks({orgId:org});assert.equal((await state(queueId)).status,"superseded");assert.equal(puts,count);
  });
  await t.test("human triage and weak production login never allow writeback",async()=>{
    const input=await make("repairshopr",true);
    assert.equal((await enqueueRoutingWriteback(input)).queued,false);
    Object.assign(process.env,{NODE_ENV:"production"});process.env.MANAGER_DASHBOARD_PASSWORD="admin";
    const queueId=await queued(await make());assert.equal((await state(queueId)).status,"blocked");
    await assert.rejects(approveProviderWriteback(org,queueId),/insecure_manager_access/);
    assert.equal(getProviderWritebackConfig("repairshopr").secureManagerAccess,false);
    Object.assign(process.env,{NODE_ENV:"test"});
  });
  await t.test("Syncro uses its own opt-in and cross-organization actions are rejected",async()=>{
    const input=await make("syncro"), queueId=await queued(input);
    await assert.rejects(approveProviderWriteback(otherOrg,queueId),/not_found/);
    process.env.SYNCRO_WRITEBACK_ENABLED="true";
    await approveProviderWriteback(org,queueId);await processProviderWritebacks({orgId:org});
    assert.equal((await state(queueId)).status,"succeeded");
    assert.equal((await listProviderWritebacks(otherOrg)).length,0);
    assert.ok((await getProviderWritebackStatus(org)).counts.length>0);
  });
  await t.test("auto approval remains explicit opt-in and provider leases prevent duplicate workers",async()=>{
    process.env.REPAIRSHOPR_WRITEBACK_AUTO_APPROVE="true";
    const input=await make(), queueId=await queued(input), count=puts;
    assert.equal((await state(queueId)).status,"pending");
    await db.query("insert into provider_writeback_locks(org_id,provider,token,expires_at) values($1,'repairshopr',$2,now()+interval '10 minutes')",[org,randomUUID()]);
    assert.equal((await processProviderWritebacks({orgId:org})).processed,0);assert.equal(puts,count);
    await db.query("delete from provider_writeback_locks where org_id=$1",[org]);
    await processProviderWritebacks({orgId:org});assert.equal((await state(queueId)).status,"succeeded");
  });
  await t.test("recovery queues only persisted explicit proposals and all mutations are auditable",async()=>{
    delete process.env.REPAIRSHOPR_WRITEBACK_AUTO_APPROVE;
    const input=await make();
    await make(); // Successful old assessment without proposedRouting must never be exported.
    await db.query("update jev_assessments set result=jsonb_set(result,'{routing,proposedRouting}',$2::jsonb) where id=$1",[input.assessmentId,JSON.stringify({priority:"P2",assignedUserId:null,sourceUpdatedAt:"2026-09-01T00:00:00Z"})]);
    assert.equal((await reconcileProviderWritebacks(org)).queued,1);
    assert.equal((await reconcileProviderWritebacks(org)).queued,0);
    const row=(await db.query<{id:string;status:string}>("select id,status from provider_writebacks where assessment_id=$1",[input.assessmentId])).rows[0];
    assert.equal(row.status,"awaiting_approval");
    await approveProviderWriteback(org,row.id);await processProviderWritebacks({orgId:org});
    const actions=(await db.query<{action:string}>("select action from audit_logs where entity_id=$1",[input.ticketId])).rows.map(row=>row.action);
    assert.ok(actions.includes("provider_writeback_approved"));assert.ok(actions.includes("provider_writeback_result"));
  });
  await t.test("recovery of a stale source proposal remains blocked and a new triage supersedes old approved work",async()=>{
    const input=await make();
    await db.query("update jev_assessments set result=jsonb_set(result,'{routing,proposedRouting}',$2::jsonb) where id=$1",[input.assessmentId,JSON.stringify({priority:"P2",sourceUpdatedAt:"2026-08-01T00:00:00Z"})]);
    await reconcileProviderWritebacks(org);
    const row=(await db.query<{id:string;status:string}>("select id,status from provider_writebacks where assessment_id=$1",[input.assessmentId])).rows[0];
    assert.equal(row.status,"blocked");await assert.rejects(approveProviderWriteback(org,row.id),/proposal_source_changed/);
    const second=await make(), queueId=await queued(second);await approveProviderWriteback(org,queueId);
    const newer=randomUUID();
    await db.query("insert into jev_assessments(id,org_id,ticket_id,kind,status,idempotency_key,created_at) values($1,$2,$3,'triage','pending',$4,now()+interval '1 second')",[newer,org,second.ticketId,newer]);
    const count=puts;await processProviderWritebacks({orgId:org});assert.equal((await state(queueId)).status,"superseded");assert.equal(puts,count);
  });
});
