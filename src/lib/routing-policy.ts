import { getSql } from "./db";
import type { JevUrgency, Priority } from "./types";

export type RoutingMatch = { issueType?: string; urgency?: JevUrgency; source?: string };
export type RoutingAction = { priority?: Priority; teamId?: string; slaMinutes?: number };
export type RoutingRuleInput = {
  name: string;
  isActive: boolean;
  order: number;
  match: RoutingMatch;
  action: RoutingAction;
};
export type RoutingRule = RoutingRuleInput & { id: string; createdAt: string };
export type RoutingDefaults = { priority: Priority; slaMinutes: number; teamId: string | null };
export type RoutingFacts = {
  issueType: string | null;
  urgency: JevUrgency | null;
  source: string | null;
  needsHuman?: boolean;
  confidence?: number | null;
};

export class RoutingPolicyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RoutingPolicyError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issueTypes = ["account_access", "hardware", "software", "network", "security", "billing", "monitoring_alert", "other"];
const urgencies = ["critical", "high", "normal", "low"];
const priorities = ["P1", "P2", "P3", "P4"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoutingPolicyError("A rule must be a JSON object.");
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RoutingPolicyError("The rule contains an unsupported field.");
}
function optionalText(value: unknown, label: string, limit = 80) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) throw new RoutingPolicyError(`${label} is invalid.`);
  return value.trim();
}

export function routingRuleId(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) throw new RoutingPolicyError("A valid rule ID is required.");
  return value;
}

export function parseRoutingRule(value: unknown): RoutingRuleInput {
  const row = object(value);
  onlyKeys(row, ["name", "isActive", "order", "match", "action"]);
  const name = optionalText(row.name, "Rule name", 120);
  if (!name) throw new RoutingPolicyError("A rule name is required.");
  const order = row.order ?? 100;
  if (typeof order !== "number" || !Number.isInteger(order) || order < 0 || order > 100000) throw new RoutingPolicyError("Order must be a whole number from 0 to 100000.");
  if (row.isActive !== undefined && typeof row.isActive !== "boolean") throw new RoutingPolicyError("Active must be true or false.");
  const match = object(row.match ?? {});
  const action = object(row.action ?? {});
  onlyKeys(match, ["issueType", "urgency", "source"]);
  onlyKeys(action, ["priority", "teamId", "slaMinutes"]);
  const issueType = optionalText(match.issueType, "Issue type")?.toLowerCase();
  const urgency = optionalText(match.urgency, "Urgency")?.toLowerCase();
  const source = optionalText(match.source, "Source")?.toLowerCase();
  if (issueType && !issueTypes.includes(issueType)) throw new RoutingPolicyError("Choose a supported issue type.");
  if (urgency && !urgencies.includes(urgency)) throw new RoutingPolicyError("Choose a supported urgency.");
  if (source && !/^[a-z0-9][a-z0-9_.:-]*$/.test(source)) throw new RoutingPolicyError("Source must be a source identifier, such as repairshopr or alert_email.");
  const priority = optionalText(action.priority, "Priority");
  if (priority && !priorities.includes(priority)) throw new RoutingPolicyError("Priority must be P1, P2, P3, or P4.");
  const teamId = optionalText(action.teamId, "Team ID");
  if (teamId && !uuid.test(teamId)) throw new RoutingPolicyError("Choose a valid team.");
  const slaMinutes = action.slaMinutes;
  if (slaMinutes !== undefined && (typeof slaMinutes !== "number" || !Number.isInteger(slaMinutes) || slaMinutes < 1 || slaMinutes > 43200)) {
    throw new RoutingPolicyError("Response deadline must be 1 to 43200 whole minutes.");
  }
  if (!priority && !teamId && slaMinutes === undefined) throw new RoutingPolicyError("Set at least one action: priority, team, or response deadline.");
  return {
    name, order, isActive: row.isActive !== false,
    match: { ...(issueType ? { issueType } : {}), ...(urgency ? { urgency: urgency as JevUrgency } : {}), ...(source ? { source } : {}) },
    action: { ...(priority ? { priority: priority as Priority } : {}), ...(teamId ? { teamId } : {}), ...(slaMinutes !== undefined ? { slaMinutes: slaMinutes as number } : {}) },
  };
}

function mapRule(row: Record<string, unknown>): RoutingRule {
  return {
    ...parseRoutingRule({ name: row.name, isActive: row.is_active, order: Number(row.priority), match: row.match_json, action: row.action_json }),
    id: String(row.id), createdAt: String(row.created_at),
  };
}

export async function listRoutingRules(orgId: string) {
  const rows = await getSql()`select id::text,name,is_active,match_json,action_json,priority,created_at::text
    from routing_rules where org_id=${orgId} order by priority,created_at,id`;
  return rows.map(mapRule);
}

export async function routingTeams(orgId: string) {
  const rows = await getSql()`select id::text,name from teams where org_id=${orgId} order by name,id`;
  return rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

async function validateTeam(orgId: string, teamId?: string) {
  if (!teamId) return;
  const rows = await getSql()`select id from teams where id=${teamId}::uuid and org_id=${orgId}`;
  if (!rows.length) throw new RoutingPolicyError("The selected team does not belong to this workspace.");
}

function writeFailure(error: unknown): never {
  if (error instanceof RoutingPolicyError) throw error;
  if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new RoutingPolicyError("A rule with that name already exists.", 409);
  throw error;
}

export async function saveRoutingRule(orgId: string, value: unknown, ruleId?: string) {
  const rule = parseRoutingRule(value);
  if (ruleId !== undefined) routingRuleId(ruleId);
  await validateTeam(orgId, rule.action.teamId);
  const sql = getSql();
  try {
    const rows = ruleId ? await sql`with saved as (
      update routing_rules set name=${rule.name},is_active=${rule.isActive},priority=${rule.order},
        match_json=${JSON.stringify(rule.match)}::jsonb,action_json=${JSON.stringify(rule.action)}::jsonb
      where id=${ruleId}::uuid and org_id=${orgId} returning *
    ), logged as (
      insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'system','routing_rule',id,'manager.routing_rule.updated',
        jsonb_build_object('actor','manager workspace session','rule',to_jsonb(saved)) from saved
    ) select id::text,name,is_active,match_json,action_json,priority,created_at::text from saved`
      : await sql`with saved as (
      insert into routing_rules(org_id,name,is_active,priority,match_json,action_json)
      values (${orgId},${rule.name},${rule.isActive},${rule.order},${JSON.stringify(rule.match)}::jsonb,${JSON.stringify(rule.action)}::jsonb) returning *
    ), logged as (
      insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'system','routing_rule',id,'manager.routing_rule.created',
        jsonb_build_object('actor','manager workspace session','rule',to_jsonb(saved)) from saved
    ) select id::text,name,is_active,match_json,action_json,priority,created_at::text from saved`;
    if (!rows.length) throw new RoutingPolicyError("Rule not found in this workspace.", 404);
    return mapRule(rows[0]);
  } catch (error) { return writeFailure(error); }
}

export async function setRoutingRuleActive(orgId: string, id: string, isActive: boolean) {
  routingRuleId(id);
  if (typeof isActive !== "boolean") throw new RoutingPolicyError("Active must be true or false.");
  const rows = await getSql()`with saved as (
    update routing_rules set is_active=${isActive} where org_id=${orgId} and id=${id}::uuid returning *
  ), logged as (
    insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    select org_id,'system','routing_rule',id,'manager.routing_rule.toggled',
      jsonb_build_object('actor','manager workspace session','isActive',is_active) from saved
  ) select id::text,name,is_active,match_json,action_json,priority,created_at::text from saved`;
  if (!rows.length) throw new RoutingPolicyError("Rule not found in this workspace.", 404);
  return mapRule(rows[0]);
}

export async function deleteRoutingRule(orgId: string, id: string) {
  routingRuleId(id);
  const rows = await getSql()`with removed as (
    delete from routing_rules where org_id=${orgId} and id=${id}::uuid returning *
  ), logged as (
    insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
    select org_id,'system','routing_rule',id,'manager.routing_rule.deleted',
      jsonb_build_object('actor','manager workspace session','previousRule',to_jsonb(removed)) from removed
  ) select id::text from removed`;
  if (!rows.length) throw new RoutingPolicyError("Rule not found in this workspace.", 404);
  return { id };
}

export function matchConfiguredRouting(rules: RoutingRule[], facts: RoutingFacts, defaults: RoutingDefaults) {
  const unchanged = { ...defaults, ruleId: null as string | null, ruleName: null as string | null };
  // The Jev caller owns confidence thresholds; a manager policy cannot waive human triage.
  if (facts.needsHuman) return unchanged;
  const rule = [...rules].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).find(candidate => {
    if (!candidate.isActive) return false;
    return Object.entries(candidate.match).every(([key, expected]) => {
      const actual = facts[key as keyof RoutingMatch];
      return typeof actual === "string" && actual.trim().toLowerCase() === expected;
    });
  });
  return rule ? { ...defaults, ...rule.action, ruleId: rule.id, ruleName: rule.name } : unchanged;
}

export async function evaluateConfiguredRouting(orgId: string, facts: RoutingFacts, defaults: RoutingDefaults) {
  if (facts.needsHuman) return { ...defaults, ruleId: null, ruleName: null };
  const [rules, teams] = await Promise.all([listRoutingRules(orgId), routingTeams(orgId)]);
  const teamIds = new Set(teams.map(team => team.id));
  // Never apply a stale or cross-workspace team reference, including direct DB edits.
  return matchConfiguredRouting(rules.filter(rule => !rule.action.teamId || teamIds.has(rule.action.teamId)), facts, defaults);
}
