import assert from "node:assert/strict";
import test from "node:test";
import {
  isAppAccessAuthorized,
  isManagerDashboardAuthorized,
} from "./manager-auth";

test("manager dashboard accepts configured Basic and Bearer credentials", (t) => {
  const previousPassword = process.env.MANAGER_DASHBOARD_PASSWORD;
  const previousUsername = process.env.MANAGER_DASHBOARD_USERNAME;
  t.after(() => {
    if (previousPassword === undefined) {
      delete process.env.MANAGER_DASHBOARD_PASSWORD;
    } else {
      process.env.MANAGER_DASHBOARD_PASSWORD = previousPassword;
    }
    if (previousUsername === undefined) {
      delete process.env.MANAGER_DASHBOARD_USERNAME;
    } else {
      process.env.MANAGER_DASHBOARD_USERNAME = previousUsername;
    }
  });
  process.env.MANAGER_DASHBOARD_USERNAME = "lead";
  process.env.MANAGER_DASHBOARD_PASSWORD = "quality-secret";

  const basic = Buffer.from("lead:quality-secret").toString("base64");
  assert.equal(
    isManagerDashboardAuthorized(
      new Request("https://example.com/api/quality", {
        headers: { authorization: `Basic ${basic}` },
      }),
    ),
    true,
  );
  assert.equal(
    isManagerDashboardAuthorized(
      new Request("https://example.com/api/quality", {
        headers: { authorization: "Bearer quality-secret" },
      }),
    ),
    true,
  );
  assert.equal(
    isManagerDashboardAuthorized(
      new Request("https://example.com/api/quality", {
        headers: { authorization: "Bearer wrong" },
      }),
    ),
    false,
  );
});

test("helpdesk access uses a separate configured credential", (t) => {
  const previousPassword = process.env.APP_ACCESS_PASSWORD;
  const previousUsername = process.env.APP_ACCESS_USERNAME;
  t.after(() => {
    if (previousPassword === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previousPassword;
    if (previousUsername === undefined) delete process.env.APP_ACCESS_USERNAME;
    else process.env.APP_ACCESS_USERNAME = previousUsername;
  });
  process.env.APP_ACCESS_USERNAME = "technician";
  process.env.APP_ACCESS_PASSWORD = "workspace-secret";

  const basic = Buffer.from("technician:workspace-secret").toString("base64");
  assert.equal(
    isAppAccessAuthorized(
      new Request("https://example.com/api/tickets", {
        headers: { authorization: `Basic ${basic}` },
      }),
    ),
    true,
  );
  assert.equal(
    isAppAccessAuthorized(
      new Request("https://example.com/api/tickets", {
        headers: { authorization: "Bearer workspace-secret" },
      }),
    ),
    true,
  );
});
