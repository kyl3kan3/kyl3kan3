import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { getManagerQualityData } from "./quality-dashboard";
import { ensureJevSchema } from "./jev-schema";
import { GET } from "../app/api/quality/route";

test("manager quality metrics keep fair cohorts, evidence-backed response times, and unique ticket counts", async t => {
  const db = new PGlite();
  const schema = (await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"))
    .split("with org as (")[0].replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  await db.exec("alter table tickets add column if not exists repairshopr_evidence jsonb; alter table tickets add column if not exists syncro_evidence jsonb");
  const org = "11111111-1111-4111-8111-111111111111";
  const alice = "22222222-2222-4222-8222-222222222222";
  const bob = "33333333-3333-4333-8333-333333333333";
  await db.query("insert into orgs(id,name) values ($1,'Default Operations')", [org]);
  await db.query("insert into users(id,org_id,email,full_name,role) values ($1,$3,'alice@test.invalid','Alice','agent'),($2,$3,'bob@test.invalid','Bob','agent')", [alice,bob,org]);
  const previous = { ...process.env };
  const previousFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://test:test@test.invalid/test";
  process.env.MANAGER_DASHBOARD_PASSWORD = "quality-test-manager-password";
  t.after(async () => { process.env = previous; neonConfig.fetchFunction = previousFetch; await db.close(); });
  const databaseErrors: string[] = [];
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    try {
      const result = await db.query<Record<string, unknown>>(request.query, request.params);
      return Response.json({ fields: result.fields, rows: result.rows.map(row => result.fields.map(field => {
        const value = row[field.name];
        return value === null ? null : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      })), rowCount: result.affectedRows ?? result.rows.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Query failed";
      databaseErrors.push(message);
      return Response.json({ message }, { status: 400 });
    }
  };
  await ensureJevSchema();

  const now = Date.now();
  const day = 86400000;
  const created = new Date(now - 4 * day).toISOString();
  const submitted = new Date(now - 2 * day).toISOString();
  const responseAt = (minutes: number) => new Date(new Date(created).getTime() + minutes * 60000).toISOString();
  const publicNote = (at: string) => ({ at, actor: "source technician", action: "customer-facing technician message", evidence: "Customer received clear steps" });

  async function ticket(title: string, firstResponse: string | null = null, history: unknown[] = [], source = "repairshopr") {
    const result = await db.query<{ id: string }>(`insert into tickets(org_id,title,status,priority,created_from,created_at,first_response_at,repairshopr_evidence,syncro_evidence)
      values($1,$2,'resolved','P3',$3,$4,$5,$6,$7) returning id`, [org,title,source,created,firstResponse,JSON.stringify(source === "repairshopr" ? history : []),JSON.stringify(source === "syncro" ? history : [])]);
    return result.rows[0].id;
  }
  async function review(ticketId: string, options: {
    cycle?: number; technician?: string | null; role?: string; issue?: string; model?: string; rubric?: string; procedure?: string;
    status?: string; score?: number | null; missing?: number; at?: string; olderModel?: boolean;
  } = {}) {
    const technician = options.technician === undefined ? alice : options.technician;
    const at = options.at ?? submitted;
    const cycle = options.cycle ?? 1;
    const submission = (await db.query<{ id: string }>(`insert into ticket_completion_submissions(org_id,ticket_id,completion_cycle,technician_user_id,technician_name,technician_role,issue_type,submitted_at)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [org,ticketId,cycle,technician,technician === alice ? "Alice" : technician === bob ? "Bob" : null,options.role ?? "agent",options.issue ?? "network",at])).rows[0].id;
    if (options.olderModel) {
      await db.query(`insert into jev_assessments(org_id,ticket_id,completion_submission_id,kind,completion_cycle,status,idempotency_key,model,rubric_version,procedure_version,overall_score,created_at)
        values($1,$2,$3,'completion_review',$4,'succeeded',$5,'obsolete-model','rubric-1','procedure-1',0,$6)`, [org,ticketId,submission,cycle,`${ticketId}:${cycle}:old`,new Date(new Date(at).getTime()-1000).toISOString()]);
    }
    await db.query(`insert into jev_assessments(org_id,ticket_id,completion_submission_id,kind,completion_cycle,status,idempotency_key,model,rubric_version,procedure_version,overall_score,missing_evidence_count,completed_at,created_at)
      values($1,$2,$3,'completion_review',$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, [org,ticketId,submission,cycle,options.status ?? "succeeded",`${ticketId}:${cycle}`,options.model ?? "model-1",options.rubric ?? "rubric-1",options.procedure ?? "procedure-1",options.score === undefined ? 100 : options.score,options.missing ?? 0,at]);
  }

  const multiple = await ticket("Multiple completion cycles", responseAt(10), [publicNote(responseAt(10))]);
  await review(multiple, { cycle: 1, score: 100, missing: 1, olderModel: true });
  await review(multiple, { cycle: 2, score: 60, at: new Date(now-day).toISOString() });
  await review(multiple, { cycle: 3, score: 20, model: "model-2", at: new Date(now-day/2).toISOString() });
  for (const [cycle, at] of [[1, now-1.5*day], [2, now-.75*day]]) {
    await db.query("insert into ticket_status_events(org_id,ticket_id,from_status,to_status,completion_cycle,changed_at) values($1,$2,'resolved','in_progress',$3,$4)", [org,multiple,cycle,new Date(at).toISOString()]);
  }
  const missing = await ticket("Missing evidence", responseAt(20), [{ ...publicNote(responseAt(20)), action: "internal technician note" }]);
  await review(missing, { score: null, missing: 3 });
  const pending = await ticket("Pending review and legacy response", responseAt(30));
  await review(pending, { status: "pending", score: 999, missing: 3 });
  const beforeCreation = await ticket("Hardware cohort", responseAt(-5), [publicNote(responseAt(-5))]);
  await review(beforeCreation, { issue: "hardware", score: 80 });
  const afterCompletion = new Date(now-day).toISOString();
  const roleChanged = await ticket("Manager role cohort", afterCompletion, [publicNote(afterCompletion)]);
  await review(roleChanged, { role: "manager", score: 40 });
  const syncro = await ticket("Syncro source-backed response", responseAt(15), [publicNote("not a valid timestamp"),publicNote(responseAt(15))], "syncro");
  await review(syncro, { technician: bob, score: 90 });
  const historical = await ticket("Unattributed historical work", responseAt(7), [publicNote(responseAt(7))]);
  await review(historical, { technician: null, score: 80, missing: 1 });
  const old = await ticket("Outside the selected window");
  await review(old, { at: new Date(now-40*day).toISOString() });
  const procedure = await ticket("Different procedure cohort");
  await review(procedure, { procedure: "procedure-2", score: 100 });
  const rubric = await ticket("Different rubric cohort");
  await review(rubric, { rubric: "rubric-2", score: 50 });

  const data = await getManagerQualityData(30);
  assert.equal(data.dbError, undefined, databaseErrors.join("\n"));
  assert.equal(data.source, "database");
  assert.equal(data.summary.handledTickets, 8, "a ticket appearing in multiple completion cycles/model cohorts is one handled ticket");
  assert.equal(data.summary.reviewedTickets, 9, "reviewed count tracks successful attributable completion reviews, not pending or superseded model results");
  assert.equal(data.summary.missingEvidenceCount, 4);
  assert.equal(data.summary.evidenceCoverage, 85.19);
  assert.equal(data.rows.length, 7, "technician, role, issue, model, rubric, and procedure cohorts stay separate");
  assert.equal(data.rows.some(row => row.model === "obsolete-model"), false);
  const primary = data.rows.find(row => row.technicianId === alice && row.role === "agent" && row.issueType === "network" && row.model === "model-1" && row.rubricVersion === "rubric-1" && row.procedureVersion === "procedure-1")!;
  assert.equal(primary.handledTickets, 3);
  assert.equal(primary.reviewedTickets, 3);
  assert.equal(primary.scoredCriteria, 5);
  assert.equal(primary.missingEvidenceCount, 4);
  assert.equal(primary.qualityScore, 76, "missing evidence and pending results must not lower or inflate quality");
  assert.equal(primary.evidenceCoverage, 55.56);
  assert.equal(primary.reopenedTickets, 1, "multiple reopen events count the ticket once inside its cohort");
  assert.equal(primary.reopenedRate, 1/3);
  assert.equal(primary.averageResponseMinutes, 10, "internal notes and bare legacy timestamps are not customer responses");
  assert.equal(primary.medianResponseMinutes, 10);
  assert.equal(data.rows.find(row => row.technicianId === bob)?.averageResponseMinutes, 15, "Syncro reads its own evidence even if an empty RepairShopr array exists");
  assert.equal(data.rows.find(row => row.issueType === "hardware")?.averageResponseMinutes, null);
  assert.equal(data.rows.find(row => row.role === "manager")?.averageResponseMinutes, null);
  assert.equal(data.examples?.find(example => example.ticketId === historical)?.technician, null);
  assert.ok(data.examples?.some(example => example.ticketId === historical), "unattributed work remains available for manager review without employee credit");
  assert.equal(data.examples?.find(example => example.ticketId === pending)?.overallScore, null, "pending reviews must not present stale scores as finished quality");
  assert.equal(data.examples?.some(example => example.ticketId === old), false);

  const missingOnly = await ticket("All missing separate cohort");
  await review(missingOnly, { issue: "security", score: null, missing: 3 });
  const missingOnlyRow = (await getManagerQualityData()).rows.find(row => row.issueType === "security")!;
  assert.equal(missingOnlyRow.qualityScore, null, "no evidenced criteria means unknown quality, not zero performance");
  assert.equal(missingOnlyRow.scoredCriteria, 0);
  assert.equal(missingOnlyRow.evidenceCoverage, 0);

  for (const days of ["garbage", "12junk", "", "1.5", "-1"]) {
    const response = await GET(new Request(`https://desk.example/api/quality?days=${encodeURIComponent(days)}`, { headers: { authorization: "Bearer quality-test-manager-password" } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).windowDays, 30);
  }
  assert.equal((await getManagerQualityData(1)).windowDays, 7);
  assert.equal((await getManagerQualityData(9999)).windowDays, 365);
  assert.equal((await getManagerQualityData(Number.NaN)).windowDays, 30);
  assert.equal((await GET(new Request("https://desk.example/api/quality"))).status, 401);
});
