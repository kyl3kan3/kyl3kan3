import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import {
  deleteRoutingRule, evaluateConfiguredRouting, listRoutingRules, matchConfiguredRouting,
  parseRoutingRule, RoutingPolicyError, saveRoutingRule, setRoutingRuleActive, type RoutingRule,
} from "./routing-policy";
import { createSession, SESSION_COOKIE } from "./auth-session";
import { GET, POST, PUT, PATCH, DELETE } from "../app/api/routing-rules/route";

const defaults = { priority: "P3" as const, slaMinutes: 60, teamId: null };
const facts = { issueType: "network", urgency: "high" as const, source: "syncro" };

test("routing validation rejects unsafe, incomplete, or out-of-range policies", () => {
  const valid = { name: "Network", order: 10, match: { issueType: "NETWORK" }, action: { priority: "P2" } };
  assert.deepEqual(parseRoutingRule(valid), { ...valid, isActive: true, match: { issueType: "network" } });
  for (const invalid of [
    null, [], { ...valid, name: "" }, { ...valid, action: {} }, { ...valid, action: { priority: "P0" } },
    { ...valid, action: { slaMinutes: 0 } }, { ...valid, action: { slaMinutes: 1.5 } },
    { ...valid, action: { slaMinutes: 43201 } }, { ...valid, action: { teamId: "../teams" } },
    { ...valid, action: { needsHuman: false } }, { ...valid, match: { confidence: 0 } },
    { ...valid, match: { issueType: "fiction" } }, { ...valid, match: { urgency: "ASAP" } },
    { ...valid, order: -1 }, { ...valid, order: "1" }, { ...valid, isActive: "true" },
  ]) assert.throws(() => parseRoutingRule(invalid), RoutingPolicyError);
});

test("first active rule wins with deterministic ties and can never waive human triage", () => {
  function rule(id: string, order: number, changes: Partial<RoutingRule> = {}): RoutingRule {
    return { id, name: id, order, isActive: true, match: {}, action: { priority: "P1" }, createdAt: "2026-01-01", ...changes };
  }
  const rules = [
    rule("z", 20), rule("paused", 0, { isActive: false }),
    rule("wrong", 1, { match: { source: "repairshopr" } }),
    rule("b", 10, { match: { issueType: "network", urgency: "high", source: "syncro" }, action: { priority: "P2", slaMinutes: 15 } }),
    rule("a", 10, { action: { slaMinutes: 30 } }),
  ];
  assert.deepEqual(matchConfiguredRouting(rules, facts, defaults), { ...defaults, slaMinutes: 30, ruleId: "a", ruleName: "a" });
  assert.deepEqual(matchConfiguredRouting(rules, { ...facts, needsHuman: true, confidence: 1 }, defaults), { ...defaults, ruleId: null, ruleName: null });
  assert.deepEqual(matchConfiguredRouting([], facts, defaults), { ...defaults, ruleId: null, ruleName: null });
  const conditional = rules.filter(rule => rule.id === "b");
  assert.equal(matchConfiguredRouting(conditional, { ...facts, urgency: "low" }, defaults).ruleId, null);
  assert.equal(matchConfiguredRouting(conditional, facts, defaults).priority, "P2");
  assert.equal(matchConfiguredRouting(conditional, { ...facts, issueType: null }, defaults).ruleId, null);
});

test("routing rule CRUD, team isolation, atomic audit, and manager API work against Postgres", async t => {
  const db = new PGlite();
  const schema = (await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"))
    .split("with org as (")[0].replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  const org = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const team = "33333333-3333-4333-8333-333333333333";
  const foreignTeam = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into orgs(id,name) values ($1,'Default Operations'),($2,'Other workspace')", [org, other]);
  await db.query("insert into teams(id,org_id,name) values ($1,$2,'Network'),($3,$4,'Other network')", [team, org, foreignTeam, other]);
  const previous = { ...process.env };
  const previousFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://test:test@test.invalid/test";
  process.env.MANAGER_DASHBOARD_PASSWORD = "manager-routing-test-secret";
  process.env.APP_ACCESS_PASSWORD = "operator-routing-test-secret";
  t.after(async () => { process.env = previous; neonConfig.fetchFunction = previousFetch; await db.close(); });
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    try {
      const result = await db.query<Record<string, unknown>>(request.query, request.params);
      return Response.json({ fields: result.fields, rows: result.rows.map(row => result.fields.map(field => {
        const value = row[field.name];
        return value === null ? null : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      })), rowCount: result.affectedRows ?? result.rows.length });
    } catch (error) {
      return Response.json({ message: error instanceof Error ? error.message : "Query failed", code: error && typeof error === "object" && "code" in error ? error.code : undefined }, { status: 400 });
    }
  };
  const input = { name: "Network incidents", order: 10, match: { issueType: "network", source: "syncro" }, action: { priority: "P2", teamId: team, slaMinutes: 15 } };
  const created = await saveRoutingRule(org, input);
  assert.equal(created.name, input.name);
  assert.equal((await listRoutingRules(org)).length, 1);
  assert.deepEqual(await evaluateConfiguredRouting(org, facts, defaults), { priority: "P2", teamId: team, slaMinutes: 15, ruleId: created.id, ruleName: input.name });
  assert.deepEqual(await evaluateConfiguredRouting(other, facts, defaults), { ...defaults, ruleId: null, ruleName: null });
  await assert.rejects(saveRoutingRule(org, { ...input, name: "Wrong team", action: { teamId: foreignTeam } }), /does not belong/);
  await assert.rejects(saveRoutingRule(org, input), /already exists/);
  await assert.rejects(saveRoutingRule(other, { ...input, action: { priority: "P1" } }, created.id), /not found/);
  await assert.rejects(setRoutingRuleActive(other, created.id, false), /not found/);
  await assert.rejects(deleteRoutingRule(other, created.id), /not found/);
  await setRoutingRuleActive(org, created.id, false);
  assert.equal((await evaluateConfiguredRouting(org, facts, defaults)).ruleId, null);
  await saveRoutingRule(org, { ...input, name: "Updated network", action: { priority: "P1", teamId: team } }, created.id);
  assert.equal((await evaluateConfiguredRouting(org, facts, defaults)).priority, "P1");
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from audit_logs where entity_type='routing_rule'")).rows[0].count, 3);

  // Direct stale/cross-org references are ignored again at evaluation time.
  await db.query("update routing_rules set action_json=$1 where id=$2", [JSON.stringify({ priority: "P1", teamId: foreignTeam }), created.id]);
  assert.equal((await evaluateConfiguredRouting(org, facts, defaults)).ruleId, null);
  await deleteRoutingRule(org, created.id);
  assert.equal((await listRoutingRules(org)).length, 0);
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from audit_logs where action='manager.routing_rule.deleted'")).rows[0].count, 1);

  await db.exec("create function reject_rule_audit() returns trigger language plpgsql as $$ begin if new.entity_type='routing_rule' then raise exception 'Audit rejected'; end if; return new; end $$; create trigger reject_rule_audit before insert on audit_logs for each row execute function reject_rule_audit()");
  await assert.rejects(saveRoutingRule(org, input), /Audit rejected/);
  assert.equal((await listRoutingRules(org)).length, 0, "audit failure must roll back the rule mutation");
  await db.exec("drop trigger reject_rule_audit on audit_logs; drop function reject_rule_audit()");

  const url = "https://desk.example/api/routing-rules";
  const request = (method: string, body?: unknown, headers: Record<string, string> = { authorization: "Bearer manager-routing-test-secret" }) => new Request(url, {
    method, headers: { ...headers, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await GET(request("GET", undefined, {}))).status, 401);
  assert.equal((await GET(request("GET", undefined, { authorization: "Bearer operator-routing-test-secret" }))).status, 401);
  assert.equal((await POST(request("POST", input, { cookie: `${SESSION_COOKIE}=${createSession("manager")}`, origin: "https://evil.example" }))).status, 403);
  const response = await POST(request("POST", input));
  assert.equal(response.status, 201);
  const id = (await response.json()).result.id;
  assert.equal((await GET(request("GET"))).status, 200);
  assert.equal((await PUT(request("PUT", { ...input, id, order: 5 }))).status, 200);
  assert.equal((await PATCH(request("PATCH", { id, isActive: false }))).status, 200);
  assert.equal((await DELETE(request("DELETE", { id }))).status, 200);
  assert.equal((await POST(request("POST", { ...input, action: {} }))).status, 400);
});
