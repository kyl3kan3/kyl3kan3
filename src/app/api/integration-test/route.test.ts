import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("integration tester accepts only the same-origin app webhook and refuses redirects", async (t) => {
  const originalFetch = globalThis.fetch;
  const keys = ["APP_ACCESS_PASSWORD", "MANAGER_DASHBOARD_PASSWORD", "APP_URL"];
  const before = keys.map(key => process.env[key]);
  process.env.APP_ACCESS_PASSWORD = "test-secret";
  process.env.MANAGER_DASHBOARD_PASSWORD = "test-secret";
  process.env.APP_URL = "https://app.test";
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];});
  });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://app.test/api/webhooks/inbound-email");
    assert.equal(init?.redirect, "error");
    return Response.json({ok:true,ticketId:"test-ticket"}, {status:202});
  }) as typeof fetch;
  const invoke = (webhookUrl:string) => POST(new Request("https://app.test/api/integration-test", {
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer test-secret"},
    body:JSON.stringify({webhookUrl}),
  }));
  for (const target of ["https://evil.test/api/webhooks/inbound-email", "https://127.0.0.1/", "/api/health",
    "/api/webhooks/inbound-email?target=evil", "https://user:password@app.test/api/webhooks/inbound-email"]) {
    assert.equal((await invoke(target)).status, 400);
  }
  assert.equal(calls,0);
  assert.equal((await invoke("/api/webhooks/inbound-email")).status,200);
  assert.equal(calls,1);
});
