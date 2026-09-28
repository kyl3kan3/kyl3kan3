import { managerRequestFailure } from "@/lib/manager-request";
import { operationsOrgId } from "@/lib/operations-status";
import { deleteRoutingRule, listRoutingRules, routingRuleId, routingTeams, RoutingPolicyError, saveRoutingRule, setRoutingRuleActive } from "@/lib/routing-policy";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

function failure(error: unknown) {
  if (error instanceof RoutingPolicyError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers });
  return Response.json({ ok: false, error: "Unable to access routing rules. Check the database connection." }, { status: 503, headers });
}

export async function GET(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    const orgId = await operationsOrgId();
    const [rules, teams] = await Promise.all([listRoutingRules(orgId), routingTeams(orgId)]);
    return Response.json({ ok: true, rules, teams }, { headers });
  } catch (error) { return failure(error); }
}

async function mutate(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    let body: Record<string, unknown>;
    try {
      const raw: unknown = await request.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid JSON object");
      body = raw as Record<string, unknown>;
    } catch { throw new RoutingPolicyError("A valid JSON object is required."); }
    const orgId = await operationsOrgId();
    let result: unknown;
    if (request.method === "POST") result = await saveRoutingRule(orgId, body);
    else {
      const { id, ...rule } = body;
      const ruleId = routingRuleId(id);
      if (request.method === "PUT") result = await saveRoutingRule(orgId, rule, ruleId);
      else if (request.method === "DELETE") result = await deleteRoutingRule(orgId, ruleId);
      else {
        if (typeof rule.isActive !== "boolean") throw new RoutingPolicyError("Active must be true or false.");
        result = await setRoutingRuleActive(orgId, ruleId, rule.isActive);
      }
    }
    return Response.json({ ok: true, result }, { status: request.method === "POST" ? 201 : 200, headers });
  } catch (error) { return failure(error); }
}

export const POST = mutate;
export const PUT = mutate;
export const PATCH = mutate;
export const DELETE = mutate;
