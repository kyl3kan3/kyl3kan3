import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { confirmHumanTriage, getAssessmentOperations, operationsOrgId, retriageTicket, retryAssessment } from "./operations-status";
import { enqueueRoutingWriteback } from "./provider-writeback";
import { GET as getOperations, POST as postOperations } from "../app/api/operations/route";

test("manager operations isolate organizations, preserve decisions, and audit changes atomically",async t=>{
  const db=new PGlite();
  const ddl=(await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;","");
  await db.exec(ddl);
  await db.exec("alter table tickets add column if not exists repairshopr_ticket_id text; alter table tickets add column if not exists repairshopr_updated_at timestamptz; alter table tickets add column if not exists repairshopr_payload jsonb");
  const org=randomUUID(),otherOrg=randomUUID(),team=randomUUID(),user=randomUUID(),otherTeam=randomUUID(),otherUser=randomUUID();
  await db.query("insert into orgs(id,name) values($1,'Default Operations'),($2,'Other Operations')",[org,otherOrg]);
  await db.query("insert into teams(id,org_id,name) values($1,$2,'Helpdesk')",[team,org]);
  await db.query("insert into users(id,org_id,email,role) values($1,$2,'tech@test.invalid','agent')",[user,org]);
  await db.query("insert into teams(id,org_id,name) values($1,$2,'Other Helpdesk')",[otherTeam,otherOrg]);
  await db.query("insert into users(id,org_id,email,role) values($1,$2,'other-tech@test.invalid','agent')",[otherUser,otherOrg]);
  const originalUrl=process.env.DATABASE_URL,originalDbFetch=neonConfig.fetchFunction;
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";
  t.after(async()=>{neonConfig.fetchFunction=originalDbFetch;if(originalUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=originalUrl;await db.close();});
  neonConfig.fetchFunction=async (_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    try {
      const result=await db.query<Record<string,unknown>>(body.query,body.params);
      return Response.json({fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];if(value===null)return null;if(value instanceof Date)return value.toISOString();
        if(field.dataTypeID===1009&&Array.isArray(value))return `{${value.map(part=>`"${part}"`).join(",")}}`;
        return typeof value==="object"?JSON.stringify(value):String(value);
      })),rowCount:result.affectedRows??result.rows.length});
    }catch(error){return Response.json({message:error instanceof Error?error.message:"query failed"},{status:400});}
  };
  const make=async(options:{orgId?:string;status?:string;assigned?:boolean;human?:boolean;source?:string}={})=>{
    const id=randomUUID();
    await db.query("insert into tickets(id,org_id,title,status,priority,created_from,assigned_team_id,assigned_user_id,triage_needs_human) values($1,$2,'Support needed',$3,'P2',$4,$5,$6,$7)",
      [id,options.orgId??org,options.status??"new",options.source??"manual",options.assigned?(options.orgId===otherOrg?otherTeam:team):null,options.assigned?(options.orgId===otherOrg?otherUser:user):null,options.human??false]);
    return id;
  };
  const assess=async(ticketId:string,status:string,orgId=org)=>{
    const id=randomUUID();
    await db.query("insert into jev_assessments(id,org_id,ticket_id,kind,status,idempotency_key,attempt_count,next_retry_at,started_at,completed_at,last_error,result) values($1,$2,$3,'triage',$4,$5,3,now()+interval '1 hour',now(),now(),'http_503',$6)",
      [id,orgId,ticketId,status,id,JSON.stringify({assessment:{needsHumanTriage:true},routing:{needsHumanTriage:true}})]);
    return id;
  };
  const state=async(id:string)=>(await db.query<Record<string,unknown>>("select * from jev_assessments where id=$1",[id])).rows[0];
  const failAudit=async()=>{await db.exec("create function reject_operation_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$; create trigger reject_operation_audit before insert on audit_logs for each row execute function reject_operation_audit()");};
  const restoreAudit=async()=>{await db.exec("drop trigger reject_operation_audit on audit_logs; drop function reject_operation_audit()");};

  await t.test("only failed, retryable, and unconfigured same-workspace assessments can be retried",async()=>{
    assert.equal(await operationsOrgId(),org);
    const ticket=await make();
    for(const status of ["failed","retryable","not_configured"]){
      const id=await assess(ticket,status);
      assert.deepEqual(await retryAssessment(org,id),{queued:true});
      const row=await state(id);assert.equal(row.status,"pending");assert.equal(row.attempt_count,0);assert.equal(row.next_retry_at,null);assert.equal(row.started_at,null);assert.equal(row.completed_at,null);
      const audit=(await db.query<{metadata:{previousError:string}}>("select metadata from audit_logs where metadata->>'assessmentId'=$1 and action='manager.assessment.retry'",[id])).rows;
      assert.equal(audit.length,1);assert.equal(audit[0].metadata.previousError,"http_503");
      await assert.rejects(retryAssessment(org,id),/not retryable/);
    }
    for(const status of ["pending","running","succeeded","superseded"]){
      const id=await assess(ticket,status);await assert.rejects(retryAssessment(org,id),/not retryable/);assert.equal((await state(id)).status,status);
    }
    const foreign=await assess(await make({orgId:otherOrg}),"failed",otherOrg);
    await assert.rejects(retryAssessment(org,foreign),/not retryable/);assert.equal((await state(foreign)).status,"failed");
    const operations=await getAssessmentOperations(org);
    assert.ok(operations.oldestPendingAt);assert.ok(operations.assessments.every(row=>row.id!==foreign));
  });
  await t.test("retry and human confirmation roll back if their audit cannot be recorded",async()=>{
    const id=await assess(await make(),"failed");
    const ticket=await make({assigned:true,human:true});
    await failAudit();
    try {
      await assert.rejects(retryAssessment(org,id),/Injected audit failure/);
      const row=await state(id);assert.equal(row.status,"failed");assert.equal(row.attempt_count,3);assert.ok(row.next_retry_at);
      await assert.rejects(confirmHumanTriage(org,ticket,"Reviewed routing and owner"),/Injected audit failure/);
      assert.equal((await db.query<{triage_needs_human:boolean}>("select triage_needs_human from tickets where id=$1",[ticket])).rows[0].triage_needs_human,true);
    } finally {await restoreAudit();}
  });
  await t.test("retriage snapshots preserve manager priority, assignment and the imported source version",async()=>{
    const ticket=await make({assigned:true,source:"repairshopr"});
    await db.query("update tickets set repairshopr_ticket_id='99',repairshopr_updated_at='2026-09-20T10:00:00Z' where id=$1",[ticket]);
    const queued=await retriageTicket(org,ticket);assert.ok(queued.assessmentId);
    const snapshot=(await state(queued.assessmentId)).input_snapshot as {preservePriority:boolean;preserveAssignment:boolean;fallbackPriority:string;sourceUpdatedAt:string;ticket:{source:string}};
    assert.equal(snapshot.preservePriority,true);assert.equal(snapshot.preserveAssignment,true);assert.equal(snapshot.fallbackPriority,"P2");
    assert.equal(Date.parse(snapshot.sourceUpdatedAt),Date.parse("2026-09-20T10:00:00Z"));assert.equal(snapshot.ticket.source,"repairshopr");
    const row=(await db.query<{priority:string;assigned_user_id:string}>("select priority,assigned_user_id from tickets where id=$1",[ticket])).rows[0];
    assert.equal(row.priority,"P2");assert.equal(row.assigned_user_id,user);
    for(const status of ["resolved","closed"])await assert.rejects(retriageTicket(org,await make({status})),/missing or completed/);
    await assert.rejects(retriageTicket(org,await make({orgId:otherOrg})),/missing or completed/);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from audit_logs where entity_id=$1 and action='manager.triage.requested'",[ticket])).rows[0].count,1);
  });
  await t.test("confirming human triage validates rationale and eligibility without granting an AI write-back",async()=>{
    const ticket=await make({assigned:true,human:true,source:"repairshopr"});
    await db.query("update tickets set repairshopr_ticket_id='101',repairshopr_updated_at='2026-09-20T10:00:00Z' where id=$1",[ticket]);
    const assessmentId=await assess(ticket,"succeeded"),before=await state(assessmentId);
    for(const reason of ["", "       ", "seven77", "x".repeat(2001)])await assert.rejects(confirmHumanTriage(org,ticket,reason),/short explanation/);
    assert.deepEqual(await confirmHumanTriage(org,ticket,"  Reviewed urgency and assigned the helpdesk owner.  "),{confirmed:true});
    assert.equal((await db.query<{triage_needs_human:boolean}>("select triage_needs_human from tickets where id=$1",[ticket])).rows[0].triage_needs_human,false);
    assert.deepEqual(await state(assessmentId),before,"Human confirmation must not rewrite historical AI judgments");
    assert.equal((await enqueueRoutingWriteback({orgId:org,ticketId:ticket,assessmentId,proposal:{priority:"P1"}})).queued,false,"AI assessment still requires human triage and cannot authorize a source write");
    const metadata=(await db.query<{metadata:{reason:string}}>("select metadata from audit_logs where entity_id=$1 and action='manager.human_triage.confirmed'",[ticket])).rows[0].metadata;
    assert.equal(metadata.reason,"Reviewed urgency and assigned the helpdesk owner.");
    await assert.rejects(confirmHumanTriage(org,ticket,"Already confirmed ticket"),/must still need human triage/);
    for(const id of [await make({human:true}),await make({status:"closed",assigned:true,human:true}),await make({assigned:true,human:false}),await make({orgId:otherOrg,human:true,assigned:true})]){
      await assert.rejects(confirmHumanTriage(org,id,"Reviewed routing and owner"),/must still need human triage/);
    }
  });
});

test("operations endpoints reject non-manager access and malformed actions before database work",async t=>{
  const keys=["MANAGER_DASHBOARD_PASSWORD","APP_ACCESS_PASSWORD","NODE_ENV"];
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}});
  process.env.MANAGER_DASHBOARD_PASSWORD="test-manager-secret";process.env.APP_ACCESS_PASSWORD="test-operator-secret";Object.assign(process.env,{NODE_ENV:"production"});
  assert.equal((await getOperations(new Request("https://desk.example/api/operations"))).status,401);
  assert.equal((await postOperations(new Request("https://desk.example/api/operations",{method:"POST",headers:{authorization:"Bearer test-operator-secret"},body:'{"action":"process_assessments"}'}))).status,401);
  for(const body of ["{","null","42",'[]','{"action":"unknown"}','{"action":"retry_assessment","id":"not-a-uuid"}','{"action":"confirm_human_triage","id":"not-a-uuid","reason":"reviewed"}']){
    const response=await postOperations(new Request("https://desk.example/api/operations",{method:"POST",headers:{authorization:"Bearer test-manager-secret","content-type":"application/json"},body}));
    assert.equal(response.status,400);assert.equal(response.headers.get("cache-control"),"no-store");
  }
});
