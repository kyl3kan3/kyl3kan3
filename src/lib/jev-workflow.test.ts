import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { createCompletionAssessment, enqueueTicketTriage, processJevAssessment, processQueuedJevAssessments } from "./jev-assessments";

test("Jev workflows preserve source authority and human decisions across asynchronous assessments", async t => {
  const db = new PGlite();
  const ddl = (await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;","");
  await db.exec(ddl);
  await db.exec("alter table tickets add column if not exists response_due_at timestamptz; alter table tickets add column if not exists repairshopr_ticket_id text; alter table tickets add column if not exists repairshopr_updated_at timestamptz; alter table tickets add column if not exists repairshopr_payload jsonb; alter table tickets add column if not exists syncro_ticket_id text; alter table tickets add column if not exists syncro_updated_at timestamptz; alter table tickets add column if not exists syncro_payload jsonb;");
  const org = randomUUID(), team = randomUUID(), technician = randomUUID(), reporter = randomUUID(), manager = randomUUID();
  await db.query("insert into orgs(id,name) values($1,'Jev workflow test')",[org]);
  await db.query("insert into teams(id,org_id,name) values($1,$2,'Helpdesk')",[team,org]);
  for (const [id,email,name,role] of [[technician,"tech@test.invalid","Technician","agent"],[reporter,"reporter@test.invalid","A Reporter","reporter"],[manager,"manager@test.invalid","Manager","manager"]]) {
    await db.query("insert into users(id,org_id,email,full_name,role) values($1,$2,$3,$4,$5)",[id,org,email,name,role]);
  }
  await db.query("insert into team_members(team_id,user_id,is_on_call) values($1,$2,false),($1,$3,true)",[team,technician,reporter]);
  await db.exec("create table repairshopr_account_binding(org_id uuid primary key references orgs(id),subdomain text not null); create table syncro_account_binding(org_id uuid primary key references orgs(id),subdomain text not null)");
  await db.query("insert into repairshopr_account_binding values($1,'test')",[org]);
  await db.query("insert into syncro_account_binding values($1,'test')",[org]);
  const envKeys = ["DATABASE_URL","AI_GATEWAY_API_KEY","JEV_MODEL","NODE_ENV",... ["REPAIRSHOPR","SYNCRO"].flatMap(prefix=>["SUBDOMAIN","API_KEY","WRITEBACK_ENABLED","WRITEBACK_AUTO_APPROVE","WRITEBACK_PRIORITY_MAP"].map(suffix=>`${prefix}_${suffix}`))];
  const before = Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const dbFetch = neonConfig.fetchFunction,networkFetch = globalThis.fetch;
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";process.env.AI_GATEWAY_API_KEY="gateway-test";
  Object.assign(process.env,{NODE_ENV:"test"});delete process.env.JEV_MODEL;
  for(const prefix of ["REPAIRSHOPR","SYNCRO"]){
    process.env[`${prefix}_SUBDOMAIN`]="test";process.env[`${prefix}_API_KEY`]="provider-test";
    process.env[`${prefix}_WRITEBACK_PRIORITY_MAP`]=JSON.stringify({P1:"Urgent",P2:"High",P3:"Normal",P4:"Low"});
    delete process.env[`${prefix}_WRITEBACK_ENABLED`];delete process.env[`${prefix}_WRITEBACK_AUTO_APPROVE`];
  }
  t.after(async()=>{neonConfig.fetchFunction=dbFetch;globalThis.fetch=networkFetch;for(const key of envKeys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await db.close();});
  let onQuery: ((query:{query:string;params:unknown[]})=>Promise<void>) | undefined;
  neonConfig.fetchFunction=async (_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const execute=async(query:{query:string;params:unknown[]})=>{
      await onQuery?.(query);
      const result=await db.query<Record<string,unknown>>(query.query,query.params);
      return {fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];
        if(value===null)return null;
        if(value instanceof Date)return value.toISOString();
        if(field.dataTypeID===1009 && Array.isArray(value))return `{${value.map(part=>`"${String(part).replaceAll('"','\\"')}"`).join(",")}}`;
        return typeof value==="object"?JSON.stringify(value):String(value);
      })),rowCount:result.affectedRows??result.rows.length};
    };
    try {
      if(body.queries){await db.exec("begin");try {const results=[];for(const q of body.queries)results.push(await execute(q));await db.exec("commit");return Response.json({results});}catch(error){await db.exec("rollback");throw error;}}
      return Response.json(await execute(body));
    }catch(error){return Response.json({message:error instanceof Error?error.message:"query failed"},{status:400});}
  };
  let gatewayCalls=0,httpStatus=200,needsHuman=false,missingEvidence=false;
  let gatewayUrgency="critical",gatewayIssue="network";
  let duringGateway: (()=>Promise<void>) | undefined;
  globalThis.fetch=(async(url,init)=>{
    gatewayCalls++;
    assert.equal(String(url),"https://ai-gateway.vercel.sh/typesafe/v1/systemone","only the AI Gateway is called; source writes remain disabled");
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer gateway-test");
    const requestUrgency=gatewayUrgency,requestIssue=gatewayIssue;
    const hook=duringGateway;duringGateway=undefined;await hook?.();
    if(httpStatus!==200)return Response.json({error:"provider failure"},{status:httpStatus});
    const body=JSON.parse(String(init?.body));
    const answers=Object.fromEntries(Object.entries(body.questions).map(([id,raw])=>{
      const question=raw as {type:string};
      if(question.type==="noul")return [id,{type:"noul",noul:id==="human_triage" ? needsHuman ? 0.95 : 0.05 : missingEvidence ? 0.1 : 0.95}];
      if(question.type==="score")return [id,{type:"score",score:2.8,confidence:0.95}];
      return [id,{type:"choice",choice:id==="issue_type"?requestIssue:id==="urgency"?requestUrgency:"team_1",confidence:0.95}];
    }));
    return Response.json({model:body.model,answers});
  }) as typeof fetch;
  let external=100;
  async function make(source="manual",owner:string|null=null) {
    const ticketId=randomUUID();
    await db.query("insert into tickets(id,org_id,title,description,status,priority,created_from,created_at,assigned_user_id,sla_due_at,reporter_email) values($1,$2,'VPN does not connect','Users cannot connect to VPN','new','P4',$3,'2026-09-01T10:00:00Z',$4,'2026-09-10T10:00:00Z','customer@test.invalid')",[ticketId,org,source,owner]);
    if(source==="repairshopr"||source==="syncro"){
      const id=String(external++);
      await db.query(`update tickets set ${source}_ticket_id=$2,${source}_updated_at='2026-09-01T11:00:00Z',${source}_payload=$3 where id=$1`,[ticketId,id,JSON.stringify({id:Number(id),status:"New",priority:"Low",user_id:owner?42:null,updated_at:"2026-09-01T11:00:00Z"})]);
    }
    return ticketId;
  }
  async function enqueue(ticketId:string,source="manual") {
    const assessmentId=await enqueueTicketTriage({orgId:org,ticketId,ticket:{title:"VPN does not connect",description:"Users cannot connect to VPN",source},fallbackPriority:"P4"});
    assert.ok(assessmentId);return assessmentId;
  }
  async function ticket(id:string){return (await db.query<Record<string,unknown>>("select * from tickets where id=$1",[id])).rows[0];}
  async function assessment(id:string){return (await db.query<{status:string;last_error:string|null;result:Record<string,unknown>;overall_score:number|null;missing_evidence_count:number}>("select status,last_error,result,overall_score,missing_evidence_count from jev_assessments where id=$1",[id])).rows[0];}

  await t.test("both imported providers retain source-owned fields and persist separate proposals plus response deadlines",async()=>{
    for(const source of ["repairshopr","syncro"]){
      const id=await make(source,technician),assessmentId=await enqueue(id,source);
      assert.equal((await processJevAssessment(assessmentId))?.status,"succeeded");
      const row=await ticket(id),a=await assessment(assessmentId);
      assert.equal(row.priority,"P4");assert.equal(row.assigned_user_id,technician);assert.equal(row.status,"new");
      assert.equal((row.sla_due_at as Date).toISOString(),"2026-09-10T10:00:00.000Z");
      assert.equal((row.response_due_at as Date).toISOString(),"2026-09-01T10:05:00.000Z");
      assert.equal(row.assigned_team_id,team);
      const routing=a.result.routing as {priority:string;proposedRouting:{priority:string;sourceUpdatedAt:string;assignedUserId?:string}};
      assert.equal(routing.priority,"P4");assert.equal(routing.proposedRouting.priority,"P1");
      assert.equal(Date.parse(routing.proposedRouting.sourceUpdatedAt),Date.parse("2026-09-01T11:00:00Z"));
      assert.equal(routing.proposedRouting.assignedUserId,undefined,"do not replace the source owner");
      const proposal=(await db.query<{status:string;desired:{priority:string}}>("select status,desired from provider_writebacks where assessment_id=$1",[assessmentId])).rows[0];
      assert.equal(proposal.status,"awaiting_approval");assert.equal(proposal.desired.priority,"Urgent");
      const count=gatewayCalls;assert.equal(await processJevAssessment(assessmentId),null);assert.equal(gatewayCalls,count);
    }
  });
  await t.test("a source update while the Gateway request is pending supersedes the assessment without overwriting the new import",async()=>{
    const id=await make("repairshopr"),assessmentId=await enqueue(id,"repairshopr");
    duringGateway=async()=>{await db.query("update tickets set repairshopr_updated_at='2026-09-02T00:00:00Z',priority='P2',assigned_user_id=$2,status='in_progress',issue_type='hardware' where id=$1",[id,manager]);};
    assert.equal((await processJevAssessment(assessmentId))?.status,"superseded");
    const row=await ticket(id);
    assert.equal(row.priority,"P2");assert.equal(row.assigned_user_id,manager);assert.equal(row.status,"in_progress");assert.equal(row.issue_type,"hardware");
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from provider_writebacks where assessment_id=$1",[assessmentId])).rows[0].count,0);
  });
  await t.test("a failed Gateway response cannot mark a newer source version as needing triage",async()=>{
    const id=await make("syncro"),assessmentId=await enqueue(id,"syncro");
    duringGateway=async()=>{await db.query("update tickets set syncro_updated_at='2026-09-02T00:00:00Z',triage_needs_human=false where id=$1",[id]);};
    httpStatus=400;
    try {assert.equal((await processJevAssessment(assessmentId))?.status,"superseded");assert.equal((await ticket(id)).triage_needs_human,false);}
    finally{httpStatus=200;}
  });
  await t.test("native auto-routing never picks a reporter even when that reporter is on call",async()=>{
    const id=await make(),assessmentId=await enqueue(id);
    await processJevAssessment(assessmentId);
    const row=await ticket(id);assert.equal(row.assigned_user_id,technician);assert.equal(row.assigned_team_id,team);assert.equal(row.status,"assigned");assert.equal(row.priority,"P1");
  });
  await t.test("manager ownership and priority changes made during classification are preserved",async()=>{
    const id=await make(),assessmentId=await enqueue(id);
    duringGateway=async()=>{await db.query("update tickets set assigned_user_id=$2,assigned_team_id=$3,priority='P2' where id=$1",[id,manager,team]);};
    await processJevAssessment(assessmentId);
    const row=await ticket(id);assert.equal(row.assigned_user_id,manager);assert.equal(row.assigned_team_id,team);assert.equal(row.priority,"P2");
  });
  await t.test("uncertain Jev classification stays in human triage with no outbound proposal",async()=>{
    const id=await make("repairshopr"),assessmentId=await enqueue(id,"repairshopr");needsHuman=true;
    try {await processJevAssessment(assessmentId);}finally{needsHuman=false;}
    const row=await ticket(id);assert.equal(row.triage_needs_human,true);assert.equal(row.assigned_user_id,null);assert.equal(row.response_due_at,null);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from provider_writebacks where assessment_id=$1",[assessmentId])).rows[0].count,0);
  });
  await t.test("configured routing rules drive native routing and provider proposals without overwriting source fields",async()=>{
    const rule=randomUUID();
    await db.query("insert into routing_rules(id,org_id,name,match_json,action_json,priority) values($1,$2,'Network escalation',$3,$4,1)",[rule,org,JSON.stringify({issueType:"network"}),JSON.stringify({priority:"P2",slaMinutes:9,teamId:team})]);
    try {
      for(const source of ["manual","repairshopr"]){
        const id=await make(source,source==="manual"?null:technician),assessmentId=await enqueue(id,source);
        await processJevAssessment(assessmentId);
        const row=await ticket(id),routing=(await assessment(assessmentId)).result.routing as {configuredRuleId:string;proposedRouting:{priority:string}|null};
        assert.equal(row.priority,source==="manual"?"P2":"P4");
        assert.equal((row.response_due_at as Date).toISOString(),"2026-09-01T10:09:00.000Z");assert.equal(routing.configuredRuleId,rule);
        if(source!=="manual")assert.equal(routing.proposedRouting?.priority,"P2");
      }
    } finally {await db.query("delete from routing_rules where id=$1",[rule]);}
  });
  await t.test("a last-moment optimistic concurrency conflict cannot publish stale triage metadata or routing",async()=>{
    const id=await make("repairshopr"),assessmentId=await enqueue(id,"repairshopr");
    duringGateway=async()=>{onQuery=async query=>{
      if(query.query.includes("update tickets")&&query.query.includes("response_due_at")&&query.params.includes(id)){
        onQuery=undefined;
        await db.query("update tickets set repairshopr_updated_at='2026-09-03',priority='P2',issue_type='hardware',triage_needs_human=false where id=$1",[id]);
      }
    };};
    try {await processJevAssessment(assessmentId);}finally{onQuery=undefined;}
    const row=await ticket(id);assert.equal(row.priority,"P2");assert.equal(row.issue_type,"hardware");assert.equal(row.response_due_at,null);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from provider_writebacks where assessment_id=$1",[assessmentId])).rows[0].count,0);
  });
  await t.test("an older in-flight triage cannot replace a newer classification or shorten its response deadline",async()=>{
    for(const source of ["manual","repairshopr"]){
      const id=await make(source,source==="manual"?null:technician),older=await enqueue(id,source);
      let newer:string|null=null;
      duringGateway=async()=>{
        newer=await enqueueTicketTriage({orgId:org,ticketId:id,ticket:{title:"Updated issue: hardware question",source},fallbackPriority:"P4",idempotencyKey:`overlap:${randomUUID()}`});
        assert.ok(newer);
        await db.query("update jev_assessments set created_at=now()+interval '1 second' where id=$1",[newer]);
        gatewayUrgency="low";gatewayIssue="hardware";
        try {assert.equal((await processJevAssessment(newer))?.status,"succeeded");}
        finally{gatewayUrgency="critical";gatewayIssue="network";}
      };
      assert.equal((await processJevAssessment(older))?.status,"superseded");
      assert.ok(newer);assert.equal((await assessment(newer)).status,"succeeded");
      const row=await ticket(id);
      assert.equal(row.issue_type,"hardware");assert.equal(row.priority,"P4");
      assert.equal((row.response_due_at as Date).toISOString(),"2026-09-01T14:00:00.000Z");
      assert.equal((await db.query<{count:number}>("select count(*)::int as count from provider_writebacks where assessment_id=$1",[older])).rows[0].count,0);
    }
  });
  await t.test("reopened tickets cannot receive a stale completion score returned by an in-flight review",async()=>{
    const id=await make("manual",technician);
    await db.query("update tickets set status='resolved',completion_cycle=1,resolved_at=now() where id=$1",[id]);
    const assessmentId=await createCompletionAssessment({orgId:org,ticketId:id,completionCycle:1,resolutionSummary:"VPN settings repaired",verificationEvidence:"Reconnect succeeded",customerNextSteps:"Please reconnect"});assert.ok(assessmentId);
    duringGateway=async()=>{await db.query("update tickets set status='in_progress',resolved_at=null,reopened_count=1 where id=$1",[id]);};
    assert.equal((await processJevAssessment(assessmentId))?.status,"superseded");
    assert.equal((await assessment(assessmentId)).overall_score,null);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from audit_logs where entity_id=$1 and action='jev.completion_review.completed'",[id])).rows[0].count,0);
  });
  await t.test("missing completion evidence is recorded as missing, never scored as zero",async()=>{
    const id=await make("manual",technician);
    await db.query("update tickets set status='resolved',completion_cycle=1,resolved_at=now() where id=$1",[id]);
    const assessmentId=await createCompletionAssessment({orgId:org,ticketId:id,completionCycle:1});assert.ok(assessmentId);
    missingEvidence=true;try {await processJevAssessment(assessmentId);}finally{missingEvidence=false;}
    const row=await assessment(assessmentId);assert.equal(row.status,"succeeded");assert.equal(row.overall_score,null);assert.equal(row.missing_evidence_count,3);
  });
  await t.test("one unexpected job error does not starve the remaining queue",async()=>{
    // Prevent reconciliation of deliberately untouched fixtures from obscuring this batch.
    await db.exec("update jev_assessments set status='failed' where status in ('pending','running','retryable')");
    const badTicket=await make(),bad=await enqueue(badTicket),goodTicket=await make(),good=await enqueue(goodTicket);
    onQuery=async query=>{if(query.query.includes("as source_updated_at")&&query.params.includes(badTicket)){onQuery=undefined;throw new Error("Injected transient ticket lookup failure");}};
    try {await processQueuedJevAssessments(100,30_000);}finally{onQuery=undefined;}
    assert.notEqual((await assessment(bad)).status,"running");assert.equal((await assessment(good)).status,"succeeded");
  });
  await t.test("malformed persisted snapshots fail rather than staying indefinitely running",async()=>{
    const id=await make(),assessmentId=await enqueue(id);
    await db.query("update jev_assessments set input_snapshot='null'::jsonb where id=$1",[assessmentId]);
    await processJevAssessment(assessmentId);
    assert.equal((await assessment(assessmentId)).status,"failed");assert.equal((await assessment(assessmentId)).last_error,"invalid_input_snapshot");
  });
});
