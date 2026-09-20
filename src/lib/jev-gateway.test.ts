import assert from "node:assert/strict";
import test from "node:test";
import { classifyTicketWithJev, reviewCompletedWorkWithJev } from "./jev";
import { isJevConfigured, jevGatewayCredential } from "./jev-config";

test("reads rotating Vercel request-context credentials", (t) => {
  const symbol=Symbol.for("@vercel/request-context");
  const globals=globalThis as unknown as Record<symbol, unknown>;
  const prior=globals[symbol];
  const key=process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  t.after(()=>{if(prior===undefined)delete globals[symbol];else globals[symbol]=prior;if(key===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=key;});
  let token="first-request";
  globals[symbol]={get:()=>({headers:{"x-vercel-oidc-token":token}})};
  assert.equal(jevGatewayCredential(),"first-request");
  token="second-request";
  assert.equal(jevGatewayCredential(),"second-request");
});

test("both Jev stages use Gateway credentials and preserve typed answers", async (t) => {
  const keys = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "TYPESAFE_API_KEY", "JEV_MODEL"];
  const before = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  });
  delete process.env.JEV_MODEL;
  process.env.AI_GATEWAY_API_KEY = "gateway-test";
  process.env.VERCEL_OIDC_TOKEN = "oidc-test";
  process.env.TYPESAFE_API_KEY = "must-not-be-used";
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    assert.equal(new Headers(init?.headers).get("authorization"), calls === 1 ? "Bearer gateway-test" : "Bearer oidc-test");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "typesafe-ai/jev");
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, raw]) => {
      const question = raw as { type: string };
      if (question.type === "noul") return [id, { type: "noul", noul: id === "human_triage" ? 0.1 : 0.95 }];
      if (question.type === "score") return [id, { type: "score", score: 2.8, confidence: 0.9 }];
      return [id, { type: "choice", choice: id === "issue_type" ? "software" : id === "urgency" ? "normal" : "team_1", confidence: 0.9 }];
    }));
    return Response.json({ model: request.model, answers });
  }) as typeof fetch;
  assert.equal(isJevConfigured(), true);
  const triage = await classifyTicketWithJev({ ticket: { title: "App does not start" }, teams: [{ id: "helpdesk", name: "Helpdesk" }] });
  assert.equal(triage.status, "succeeded");
  assert.equal(triage.suggestedTeamId, "helpdesk");
  delete process.env.AI_GATEWAY_API_KEY;
  assert.equal(jevGatewayCredential(), "oidc-test");
  const review = await reviewCompletedWorkWithJev({ ticket: { title: "App does not start" }, history: [], procedures: ["Verify the application starts"] });
  assert.equal(review.status, "succeeded");
  assert.equal(review.outcome, "met");
  delete process.env.VERCEL_OIDC_TOKEN;
  assert.equal(isJevConfigured(), false);
  const missing = await classifyTicketWithJev({ ticket: { title: "No key" }, teams: [] });
  assert.equal(missing.status, "not_configured");
  assert.equal(missing.error, "missing_ai_gateway_credentials");
  assert.equal(calls, 2);
});
