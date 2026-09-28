import assert from "node:assert/strict";
import test from "node:test";
import { managerRequestFailure, appMutationFailure, hasStrongProductionAccess } from "./manager-request";
import { createSession, SESSION_COOKIE } from "./auth-session";

test("manager and operator mutations require either same-origin session or independently valid credentials", t => {
  const before = { ...process.env };
  t.after(() => { process.env = before; });
  process.env.MANAGER_DASHBOARD_PASSWORD = "manager-testing-secret";
  process.env.APP_ACCESS_PASSWORD = "operator-testing-secret";
  const cookie = (role: "manager" | "operator") => `${SESSION_COOKIE}=${createSession(role)}`;
  const request = (headers: Record<string,string>, method="POST") => new Request("https://desk.example/api/operations",{method,headers});
  assert.equal(managerRequestFailure(request({cookie:cookie("manager"),origin:"https://desk.example"})),null);
  assert.equal(managerRequestFailure(request({cookie:cookie("manager"),origin:"https://evil.example"}))?.status,403);
  assert.equal(managerRequestFailure(request({cookie:cookie("manager"),authorization:"Bearer invalid",origin:"https://evil.example"}))?.status,403);
  assert.equal(managerRequestFailure(request({cookie:cookie("operator"),origin:"https://desk.example"}))?.status,401);
  assert.equal(managerRequestFailure(request({authorization:"Bearer manager-testing-secret"})),null);
  assert.equal(managerRequestFailure(request({cookie:cookie("manager")},"GET")),null);
  assert.equal(appMutationFailure(request({cookie:cookie("operator"),origin:"https://desk.example"})),null);
  assert.equal(appMutationFailure(request({cookie:cookie("operator"),authorization:"Bearer invalid"}))?.status,403);
  assert.equal(appMutationFailure(request({authorization:"Bearer operator-testing-secret"})),null);
  assert.equal(hasStrongProductionAccess(),true);
  process.env.MANAGER_DASHBOARD_PASSWORD="admin";
  assert.equal(hasStrongProductionAccess(),false);
});
