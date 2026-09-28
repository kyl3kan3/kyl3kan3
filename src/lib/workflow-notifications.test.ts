import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { ackWorkflowNotification, listWorkflowNotifications, processWorkflowNotifications } from "./workflow-notifications";

test("workflow reminders deduplicate, preserve acknowledgment, resolve and reopen without mixing deadline meanings",async t=>{
  const db = new PGlite();
  const ddl=(await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;","");
  await db.exec(ddl);
  await db.exec("alter table tickets add column if not exists response_due_at timestamptz");
  const org=randomUUID(),otherOrg=randomUUID(),user=randomUUID();
  await db.query("insert into orgs(id,name) values($1,'Notification test'),($2,'Another notification org')",[org,otherOrg]);
  await db.query("insert into users(id,org_id,email,role) values($1,$2,'owner@test.invalid','agent')",[user,org]);
  const dbFetch=neonConfig.fetchFunction,previousUrl=process.env.DATABASE_URL,previousGrace=process.env.WORKFLOW_UNASSIGNED_GRACE_MINUTES;
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";process.env.WORKFLOW_UNASSIGNED_GRACE_MINUTES="15";
  t.after(async()=>{neonConfig.fetchFunction=dbFetch;if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
    if(previousGrace===undefined)delete process.env.WORKFLOW_UNASSIGNED_GRACE_MINUTES;else process.env.WORKFLOW_UNASSIGNED_GRACE_MINUTES=previousGrace;await db.close();});
  neonConfig.fetchFunction=async (_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    try {const result=await db.query<Record<string,unknown>>(body.query,body.params);return Response.json({fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
      const value=row[field.name];return value===null?null:value instanceof Date?value.toISOString():typeof value==="object"?JSON.stringify(value):String(value);
    })),rowCount:result.affectedRows??result.rows.length});}catch(error){return Response.json({message:error instanceof Error?error.message:"query failed"},{status:400});}
  };
  const make=async(input:{source?:string;firstResponse?:boolean;responseDue?:boolean;sourceDue?:boolean;human?:boolean;assigned?:boolean;newTicket?:boolean;org?:string}={})=>{
    const ticket=randomUUID();
    await db.query("insert into tickets(id,org_id,title,status,priority,created_from,created_at,assigned_user_id,triage_needs_human,sla_due_at,response_due_at,first_response_at) values($1,$2,'Network issue','new','P1',$3,now()-($4::text||' minutes')::interval,$5,$6,case when $7 then now()-interval '30 minutes' else null end,case when $8 then now()-interval '20 minutes' else null end,case when $9 then now()-interval '10 minutes' else null end)",
      [ticket,input.org??org,input.source??"manual",input.newTicket?0:60,input.assigned?user:null,input.human??false,input.sourceDue??false,input.responseDue??false,input.firstResponse??false]);
    return ticket;
  };
  await t.test("current conditions become one durable reminder per ticket and kind",async()=>{
    const ticket=await make({human:true,responseDue:true});
    await processWorkflowNotifications({orgId:org});await processWorkflowNotifications({orgId:org});
    const rows=(await listWorkflowNotifications(org)).filter(row=>row.ticket_id===ticket);
    assert.deepEqual(rows.map(row=>row.kind).sort(),["human_triage","sla_breach","unassigned"]);
    assert.ok(rows.every(row=>row.occurrences===1));
    const alert=rows.find(row=>row.kind==="sla_breach")!;
    assert.equal((alert.metadata as {deadlineType:string}).deadlineType,"response");
    await ackWorkflowNotification(org,String(alert.id));await ackWorkflowNotification(org,String(alert.id));
    await processWorkflowNotifications({orgId:org});
    assert.equal((await listWorkflowNotifications(org)).find(row=>row.id===alert.id)?.status,"acknowledged");
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from audit_logs where entity_id=$1 and action='workflow_notification_acknowledged'",[ticket])).rows[0].count,1);
    await db.query("update tickets set first_response_at=now(),assigned_user_id=$2,triage_needs_human=false where id=$1",[ticket,user]);
    assert.equal((await processWorkflowNotifications({orgId:org})).resolved,3);
    assert.equal((await listWorkflowNotifications(org)).filter(row=>row.ticket_id===ticket).length,0);
    await assert.rejects(ackWorkflowNotification(org,String(alert.id)),/not_open/);
    await db.query("update tickets set first_response_at=null where id=$1",[ticket]);
    await processWorkflowNotifications({orgId:org});
    const reopened=(await listWorkflowNotifications(org)).find(row=>row.id===alert.id)!;
    assert.equal(reopened.status,"open");assert.equal(reopened.occurrences,2);assert.equal(reopened.acknowledged_at,null);
  });
  await t.test("source completion deadlines never pretend to be response SLA deadlines",async()=>{
    const source=await make({source:"repairshopr",sourceDue:true,firstResponse:true,assigned:true});
    const response=await make({source:"syncro",responseDue:true,assigned:true});
    const native=await make({sourceDue:true,assigned:true});
    await processWorkflowNotifications({orgId:org});
    const rows=await listWorkflowNotifications(org);
    assert.deepEqual(rows.filter(row=>row.ticket_id===source).map(row=>row.kind),["source_deadline"]);
    assert.deepEqual(rows.filter(row=>row.ticket_id===response).map(row=>row.kind),["sla_breach"]);
    assert.deepEqual(rows.filter(row=>row.ticket_id===native).map(row=>row.kind),["sla_breach"]);
    assert.equal((rows.find(row=>row.ticket_id===source)?.metadata as {deadlineType:string}).deadlineType,"source_completion");
  });
  await t.test("new tickets have an assignment grace period and completed tickets resolve every reminder",async()=>{
    const fresh=await make({newTicket:true});
    await processWorkflowNotifications({orgId:org});
    assert.equal((await listWorkflowNotifications(org)).filter(row=>row.ticket_id===fresh).length,0);
    await db.query("update tickets set created_at=now()-interval '16 minutes' where id=$1",[fresh]);
    await processWorkflowNotifications({orgId:org});
    assert.equal((await listWorkflowNotifications(org)).find(row=>row.ticket_id===fresh)?.kind,"unassigned");
    await db.query("update tickets set status='resolved' where org_id=$1",[org]);
    await processWorkflowNotifications({orgId:org});
    assert.equal((await listWorkflowNotifications(org)).length,0);
    assert.ok((await listWorkflowNotifications(org,{includeResolved:true})).length>0);
  });
  await t.test("organization-scoped generation and acknowledgments never cross tenants",async()=>{
    const foreign=await make({org:otherOrg,human:true});
    await processWorkflowNotifications({orgId:org});assert.equal((await listWorkflowNotifications(otherOrg)).length,0);
    await processWorkflowNotifications();
    const alert=(await listWorkflowNotifications(otherOrg)).find(row=>row.ticket_id===foreign)!;
    assert.ok(alert);await assert.rejects(ackWorkflowNotification(org,String(alert.id)),/not_found/);
    await ackWorkflowNotification(otherOrg,String(alert.id));
    assert.equal((await listWorkflowNotifications(otherOrg)).find(row=>row.id===alert.id)?.status,"acknowledged");
  });
});
