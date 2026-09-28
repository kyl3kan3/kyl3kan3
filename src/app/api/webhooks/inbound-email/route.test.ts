import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { POST } from "./route";

test("durable webhook receipts prevent retry duplicates and preserve human ownership", async (t) => {
  const db=new PGlite();
  const schema=(await readFile(new URL("../../../../../db/schema.sql",import.meta.url),"utf8"))
    .split("with org as (")[0].replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  const keys=["DATABASE_URL","INBOUND_WEBHOOK_SECRET","AI_GATEWAY_API_KEY","VERCEL_OIDC_TOKEN","ALLOWED_INBOUND_RECIPIENT_DOMAINS","ALLOWED_INBOUND_RECIPIENTS"];
  const before=keys.map(key=>process.env[key]);
  const fetchBefore=neonConfig.fetchFunction;
  const globalBefore=globalThis.fetch;
  keys.forEach(key=>delete process.env[key]);
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";
  process.env.AI_GATEWAY_API_KEY="test-key";
  let providerCalls=0;
  globalThis.fetch=(async()=>{
    providerCalls++;
    return Response.json({answers:{issue_type:{type:"choice",choice:"software",confidence:0.99},urgency:{type:"choice",choice:"normal",confidence:0.99},
      suggested_team:{type:"choice",choice:"team_1",confidence:0.99},human_triage:{type:"noul",noul:0.01}}});
  }) as typeof fetch;
  neonConfig.fetchFunction=async (_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const query=JSON.parse(String(init?.body));
    try {
      const result=await db.query<Record<string,unknown>>(query.query,query.params);
      return Response.json({fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];
        return value===null?null:value instanceof Date?value.toISOString():field.dataTypeID===1009 && Array.isArray(value)
          ? `{${value.join(",")}}` :typeof value==="object"?JSON.stringify(value):String(value);
      })),rowCount:result.affectedRows??result.rows.length});
    } catch(error) {return Response.json({message:error instanceof Error?error.message:"Query failed"},{status:400});}
  };
  t.after(async()=>{
    neonConfig.fetchFunction=fetchBefore;globalThis.fetch=globalBefore;
    keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});
    await db.close();
  });
  const org=(await db.query<{id:string}>("insert into orgs(name) values('Default Operations') returning id")).rows[0].id;
  const team=(await db.query<{id:string}>("insert into teams(org_id,name) values($1,'Alpha Helpdesk') returning id",[org])).rows[0].id;
  const human=(await db.query<{id:string}>("insert into users(org_id,email,role) values($1,'human@test.invalid','agent') returning id",[org])).rows[0].id;
  const automatic=(await db.query<{id:string}>("insert into users(org_id,email,role) values($1,'automatic@test.invalid','agent') returning id",[org])).rows[0].id;
  await db.query("insert into team_members(team_id,user_id,is_on_call) values($1,$2,true)",[team,automatic]);
  const reporter=(await db.query<{id:string}>("insert into users(org_id,email,full_name,role) values($1,'reporter@test.invalid','AAA Reporter','reporter') returning id",[org])).rows[0].id;
  await db.query("insert into team_members(team_id,user_id,is_on_call) values($1,$2,true)",[team,reporter]);
  await db.query("insert into routing_rules(org_id,name,match_json,action_json) values($1,'Client software policy',$2::jsonb,$3::jsonb)",
    [org,JSON.stringify({source:'client_email',issueType:'software'}),JSON.stringify({priority:'P2',slaMinutes:17})]);
  const invoke=(id:string)=>POST(new Request("http://localhost/api/webhooks/inbound-email",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({source:"test-provider",id,from:"customer@test.invalid",to:"support@test.invalid",subject:"Application issue",body:"App will not start"})}));
  const responses=await Promise.all([invoke("delivery-1"),invoke("delivery-1")]);
  assert.ok(responses.some(response=>response.status===202));
  const accepted=responses.find(response=>response.status===202)!;
  const ticketId=(await accepted.json()).ticketId as string;
  assert.equal((await db.query<{assigned_user_id:string}>("select assigned_user_id from tickets where id=$1",[ticketId])).rows[0].assigned_user_id,automatic);
  const deadlines=(await db.query<{priority:string;minutes:number}>("select priority,extract(epoch from(response_due_at-created_at))/60 as minutes from tickets where id=$1",[ticketId])).rows[0];
  assert.equal(deadlines.priority,"P2");assert.equal(Number(deadlines.minutes),17);
  assert.equal(providerCalls,1,"the duplicate must not re-run Jev");
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from tickets")).rows[0].count,1);
  await db.query("update tickets set assigned_team_id=$1,assigned_user_id=$2,priority='P4' where id=$3",[team,human,ticketId]);
  await db.query("insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata) values($1,'system','ticket',$2,'ticket.updated',$3::jsonb)",
    [org,ticketId,JSON.stringify({priority:'P4'})]);
  const followup=await invoke("delivery-2");
  assert.equal(followup.status,202);
  const followupBody=await followup.json();
  assert.equal(followupBody.ticketId,ticketId);
  assert.equal(followupBody.assignedUserId,human);
  assert.equal(followupBody.priority,"P4","new assessment must preserve explicit human priority");
  const retry=await invoke("delivery-2");
  assert.equal(retry.status,202);
  assert.equal((await retry.json()).duplicate,true);
  assert.equal(providerCalls,2);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from alert_events")).rows[0].count,2);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_comments")).rows[0].count,1);
  assert.equal((await db.query<{blast_count:number}>("select blast_count from incidents")).rows[0].blast_count,2);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from jev_assessments")).rows[0].count,2);
  await db.exec("delete from inbound_webhook_receipts");
  const legacy=await invoke("delivery-2");
  assert.equal((await legacy.json()).duplicate,true);
  assert.equal(providerCalls,2,"historical delivery IDs must be recognized without destructive migration");
  await db.exec(`create function fail_customer_comment() returns trigger language plpgsql as $$ begin raise exception 'Injected comment failure'; end $$;
    create trigger fail_customer_comment before insert on ticket_comments for each row execute function fail_customer_comment();`);
  assert.equal((await invoke("delivery-3")).status,503);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from alert_events")).rows[0].count,2,"failed delivery cannot leave a partial alert or increment");
  assert.equal((await db.query<{blast_count:number}>("select blast_count from incidents")).rows[0].blast_count,2);
  await db.exec("drop trigger fail_customer_comment on ticket_comments; drop function fail_customer_comment()");
  assert.equal((await invoke("delivery-3")).status,202,"failed atomic receipt must be retryable immediately");
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from alert_events")).rows[0].count,3);
});

function restoreEnv(
  key:
    | "ALLOWED_INBOUND_RECIPIENT_DOMAINS"
    | "ALLOWED_INBOUND_RECIPIENTS"
    | "DATABASE_URL"
    | "INBOUND_WEBHOOK_SECRET"
    | "AI_GATEWAY_API_KEY"
    | "VERCEL_OIDC_TOKEN"
    | "RESEND_WEBHOOK_SECRET",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("rejects invalid generic JSON webhook payloads with 400", async (t) => {
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret));

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /json|unexpected|expected|valid/i);
});

test("rejects invalid signed Svix JSON webhook payloads with 400", async (t) => {
  const originalSvixSecret = process.env.RESEND_WEBHOOK_SECRET;
  const secret = "test-resend-secret";
  const id = "msg_test_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "{";
  const signature = createHmac("sha256", Buffer.from(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  process.env.RESEND_WEBHOOK_SECRET = secret;
  t.after(() => restoreEnv("RESEND_WEBHOOK_SECRET", originalSvixSecret));

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body: rawBody,
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /json|unexpected|expected|valid/i);
});

test("keeps urgent tickets P1 and sends them to human triage when Jev is not configured", async (t) => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  delete process.env.DATABASE_URL;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    restoreEnv("AI_GATEWAY_API_KEY", originalGatewayKey);
    restoreEnv("VERCEL_OIDC_TOKEN", originalOidcToken);
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@example.com",
        subject: "High Priority Test",
        body: "High Priority Test Please Place this in the need to fix immediately.",
      }),
    }),
  );
  const body = (await response.json()) as {
    priority?: string;
    jev?: {
      usedAi?: boolean;
      fallbackReason?: string | null;
      needsHumanTriage?: boolean;
    };
  };

  assert.equal(response.status, 202);
  assert.equal(body.priority, "P1");
  assert.equal(body.jev?.usedAi, false);
  assert.equal(body.jev?.fallbackReason, "missing_ai_gateway_credentials");
  assert.equal(body.jev?.needsHumanTriage, true);
});

test("rejects email sent to a recipient outside the allowed inbound domain", async (t) => {
  const originalAllowedDomains = process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS;
  const originalAllowedRecipients = process.env.ALLOWED_INBOUND_RECIPIENTS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS = "inbound.decent4.com";
  delete process.env.ALLOWED_INBOUND_RECIPIENTS;
  delete process.env.DATABASE_URL;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("ALLOWED_INBOUND_RECIPIENT_DOMAINS", originalAllowedDomains);
    restoreEnv("ALLOWED_INBOUND_RECIPIENTS", originalAllowedRecipients);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("AI_GATEWAY_API_KEY", originalGatewayKey);
    restoreEnv("VERCEL_OIDC_TOKEN", originalOidcToken);
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@wrong-domain.example",
        subject: "Wrong inbound route",
        body: "This should not become a ticket here.",
      }),
    }),
  );
  const body = (await response.json()) as {
    ok?: boolean;
    error?: string;
    allowedDomains?: string[];
  };

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Inbound recipient is not allowed for this app");
  assert.deepEqual(body.allowedDomains, ["inbound.decent4.com"]);
});

test("accepts email sent to the allowed inbound domain", async (t) => {
  const originalAllowedDomains = process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS;
  const originalAllowedRecipients = process.env.ALLOWED_INBOUND_RECIPIENTS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS = "inbound.decent4.com";
  delete process.env.ALLOWED_INBOUND_RECIPIENTS;
  delete process.env.DATABASE_URL;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("ALLOWED_INBOUND_RECIPIENT_DOMAINS", originalAllowedDomains);
    restoreEnv("ALLOWED_INBOUND_RECIPIENTS", originalAllowedRecipients);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("AI_GATEWAY_API_KEY", originalGatewayKey);
    restoreEnv("VERCEL_OIDC_TOKEN", originalOidcToken);
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@inbound.decent4.com",
        subject: "Allowed inbound route",
        body: "This belongs in this app.",
      }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean; ticketId?: string };

  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.ok(body.ticketId);
});
