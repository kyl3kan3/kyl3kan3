import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { addTicketComment, updateTicket } from "./operations";

test("ticket changes preserve atomic lifecycle and source-system boundaries", async (t) => {
  const db = new PGlite();
  const schema = (await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"))
    .split("with org as (")[0].replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  const org = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into orgs(id,name) values ($1,'Operations test')", [org]);
  await db.query("insert into users(id,org_id,email,role) values ($1,$2,'technician@test.invalid','agent')", [user, org]);
  const before = { database: process.env.DATABASE_URL, gateway: process.env.AI_GATEWAY_API_KEY, oidc: process.env.VERCEL_OIDC_TOKEN };
  const fetchBefore = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://test:test@test.invalid/test";
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  t.after(async () => {
    neonConfig.fetchFunction = fetchBefore;
    for (const [key, value] of Object.entries({DATABASE_URL: before.database, AI_GATEWAY_API_KEY: before.gateway, VERCEL_OIDC_TOKEN: before.oidc})) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    try {
      const result = await db.query<Record<string, unknown>>(body.query, body.params);
      return Response.json({ fields: result.fields, rows: result.rows.map((row) => result.fields.map((field) => {
        const value = row[field.name];
        return value === null ? null : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      })), rowCount: result.affectedRows ?? result.rows.length });
    } catch (error) {
      return Response.json({message: error instanceof Error ? error.message : "Query failed"}, {status:400});
    }
  };

  async function ticket(source = "manual") {
    const result = await db.query<{id:string}>(`insert into tickets (org_id,title,status,priority,created_from,created_at,sla_due_at)
      values ($1,'Needs work','new','P4',$2,'2026-09-01T10:00:00Z','2026-09-01T14:00:00Z') returning id`, [org,source]);
    return result.rows[0].id;
  }

  await t.test("concurrent completion records one cycle and snapshots the newly assigned owner", async () => {
    const id = await ticket();
    await Promise.all([
      updateTicket(id, {status:"resolved", assignedUserId:user, resolutionSummary:"Fixed and verified"}),
      updateTicket(id, {status:"resolved", assignedUserId:user, resolutionSummary:"Fixed and verified"}),
    ]);
    const row = (await db.query<{completion_cycle:number;status:string}>("select completion_cycle,status from tickets where id=$1", [id])).rows[0];
    assert.equal(row.status, "resolved");
    assert.equal(row.completion_cycle, 1);
    const events = (await db.query<{metadata:{technicianUserId:string}}>("select metadata from ticket_status_events where ticket_id=$1", [id])).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.technicianUserId, user);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_completion_submissions where ticket_id=$1", [id])).rows[0].count, 1);
    await Promise.all([updateTicket(id, {status:"in_progress"}), updateTicket(id, {status:"in_progress"})]);
    assert.equal((await db.query<{reopened_count:number}>("select reopened_count from tickets where id=$1", [id])).rows[0].reopened_count, 1);
  });

  await t.test("status event failure rolls back field changes and lifecycle counters", async () => {
    const id = await ticket();
    await db.exec(`create function reject_event() returns trigger language plpgsql as $$ begin raise exception 'Injected event failure'; end $$;
      create trigger reject_test_event before insert on ticket_status_events for each row execute function reject_event();`);
    await assert.rejects(updateTicket(id, {status:"resolved", title:"Must roll back", comment:"Must also roll back"}), /Injected event failure/);
    await db.exec("drop trigger reject_test_event on ticket_status_events; drop function reject_event()");
    const row = (await db.query<{title:string;status:string;completion_cycle:number}>("select title,status,completion_cycle from tickets where id=$1", [id])).rows[0];
    assert.deepEqual(row, {title:"Needs work",status:"new",completion_cycle:0});
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from ticket_comments where ticket_id=$1", [id])).rows[0].count, 0);
  });

  await t.test("escalating priority shortens the original SLA without resetting or extending it", async () => {
    const id = await ticket();
    await updateTicket(id, {priority:"P1"});
    let row = (await db.query<{sla_due_at:Date}>("select sla_due_at from tickets where id=$1", [id])).rows[0];
    assert.equal(row.sla_due_at.toISOString(), "2026-09-01T10:05:00.000Z");
    assert.equal((await db.query<{response_due_at:Date}>("select response_due_at from tickets where id=$1",[id])).rows[0].response_due_at.toISOString(),"2026-09-01T10:05:00.000Z");
    await updateTicket(id, {priority:"P4"});
    row = (await db.query<{sla_due_at:Date}>("select sla_due_at from tickets where id=$1", [id])).rows[0];
    assert.equal(row.sla_due_at.toISOString(), "2026-09-01T10:05:00.000Z");
  });

  await t.test("internal notes and work status never fabricate a customer response", async () => {
    const id = await ticket();
    await updateTicket(id, {status:"in_progress", comment:"Investigating internally"});
    await addTicketComment(id, {body:"Internal follow-up"});
    assert.deepEqual((await db.query<{author_email:string}>("select author_email from ticket_comments where ticket_id=$1",[id])).rows.map(row=>row.author_email),
      ["shared-workspace@session.invalid","shared-workspace@session.invalid"]);
    assert.equal((await db.query<{first_response_at:Date|null}>("select first_response_at from tickets where id=$1",[id])).rows[0].first_response_at,null);
    await addTicketComment(id, {body:"Customer was given next steps", countsAsResponse:true});
    assert.ok((await db.query<{first_response_at:Date|null}>("select first_response_at from tickets where id=$1",[id])).rows[0].first_response_at);
  });

  await t.test("mirrored operational edits are rejected before partial writes and source deadlines stay intact", async () => {
    for (const source of ["repairshopr", "syncro"]) {
      const id = await ticket(source);
      for (const change of [{status:"resolved" as const}, {priority:"P1" as const}, {assignedUserId:user}]) {
        await assert.rejects(updateTicket(id, {...change, title:"Must not change"}), /source system/);
      }
      await updateTicket(id, {priority:"P4", comment:"Internal annotation"});
      const row = (await db.query<{title:string;sla_due_at:Date;status:string;assigned_user_id:string|null}>("select title,sla_due_at,status,assigned_user_id from tickets where id=$1", [id])).rows[0];
      assert.equal(row.title, "Needs work");
      assert.equal(row.status, "new");
      assert.equal(row.assigned_user_id, null);
      assert.equal(row.sla_due_at.toISOString(), "2026-09-01T14:00:00.000Z");
    }
  });
});
