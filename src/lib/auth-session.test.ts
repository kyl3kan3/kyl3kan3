import assert from "node:assert/strict";
import test from "node:test";
import { createSession, loginRole, safeReturnPath, sessionRole, SESSION_COOKIE, SESSION_SECONDS } from "./auth-session";
import { isAppAccessAuthorized, isManagerDashboardAuthorized } from "./manager-auth";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("browser sessions enforce roles, expiry, signature, and password rotation", (t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.APP_ACCESS_USERNAME = "operator";
  process.env.MANAGER_DASHBOARD_USERNAME = "manager";
  process.env.APP_ACCESS_PASSWORD = "test-operator-secret";
  process.env.MANAGER_DASHBOARD_PASSWORD = "test-manager-secret";
  assert.equal(loginRole("operator", "wrong"), null);
  assert.equal(loginRole("operator", "test-operator-secret"), "operator");
  assert.equal(loginRole("manager", "test-manager-secret"), "manager");
  const token = createSession("operator");
  const request = (value: string) => new Request("https://example.com/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });
  assert.equal(sessionRole(request(token)), "operator");
  assert.equal(isAppAccessAuthorized(request(token)), true);
  assert.equal(isManagerDashboardAuthorized(request(token)), false);
  assert.equal(sessionRole(request(token.replace("operator", "manager"))), null);
  assert.equal(sessionRole(request(token + "x")), null);
  assert.equal(sessionRole(request("garbage")), null);
  assert.equal(sessionRole(request(token), Date.now() + SESSION_SECONDS * 1000), null);
  const manager = request(createSession("manager"));
  assert.equal(isAppAccessAuthorized(manager), true);
  assert.equal(isManagerDashboardAuthorized(manager), true);
  process.env.APP_ACCESS_PASSWORD = "rotated";
  assert.equal(sessionRole(request(token)), null);
});

test("return paths cannot redirect to another origin or an API", () => {
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil", "/api/tickets", "/login", undefined]) {
    assert.equal(safeReturnPath(value), "/");
  }
  assert.equal(safeReturnPath("/tickets?view=open"), "/tickets?view=open");
});

test("anonymous pages redirect to sign-in while APIs stay unauthorized without popups", (t) => {
  const previous = process.env.APP_ACCESS_PASSWORD;
  t.after(() => {
    if (previous === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previous;
  });
  process.env.APP_ACCESS_PASSWORD = "test-password";
  const page = proxy(new NextRequest("https://example.com/tickets?view=open"));
  assert.equal(page.status, 307);
  const destination = new URL(page.headers.get("location")!);
  assert.equal(destination.pathname, "/login");
  assert.equal(destination.searchParams.get("next"), "/tickets?view=open");
  const api = proxy(new NextRequest("https://example.com/api/dashboard"));
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("www-authenticate"), null);
});

test("login and logout use same-origin forms and HttpOnly sessions", async (t) => {
  const previous = process.env.APP_ACCESS_PASSWORD;
  const previousUser = process.env.APP_ACCESS_USERNAME;
  t.after(() => {
    if (previous === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previous;
    if (previousUser === undefined) delete process.env.APP_ACCESS_USERNAME;
    else process.env.APP_ACCESS_USERNAME = previousUser;
  });
  process.env.APP_ACCESS_USERNAME = "operator";
  process.env.APP_ACCESS_PASSWORD = "test-password";
  const request = (password: string, origin = "https://example.com") => new Request("https://example.com/api/auth/login", {
    method: "POST", headers: { origin }, body: new URLSearchParams({ username: "operator", password, next: "/tickets" }),
  });
  const denied = await login(request("wrong"));
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.get("set-cookie"), null);
  assert.match(denied.headers.get("location")!, /error=1/);
  assert.equal((await login(request("test-password", "https://evil.test"))).status, 403);
  const success = await login(request("test-password"));
  assert.equal(success.status, 303);
  assert.equal(success.headers.get("location"), "https://example.com/tickets");
  const cookie = success.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=strict/);
  assert.ok(!cookie.includes("test-password"));
  assert.equal(sessionRole(new Request("https://example.com", { headers: { cookie: cookie.split(";")[0] } })), "operator");
  const out = await logout(new Request("https://example.com/api/auth/logout", { method: "POST", headers: { origin: "https://example.com" } }));
  assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
});
