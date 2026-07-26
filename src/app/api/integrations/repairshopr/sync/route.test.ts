import assert from "node:assert/strict";
import test from "node:test";
import { GET as getStatus } from "../status/route";
import { POST as testConnection } from "../test/route";
import { POST } from "./route";

function restoreEnv(key: "REPAIRSHOPR_SYNC_SECRET" | "CRON_SECRET", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("rejects RepairShopr sync without a configured secret", async (t) => {
  const originalRepairShoprSecret = process.env.REPAIRSHOPR_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  delete process.env.REPAIRSHOPR_SYNC_SECRET;
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("REPAIRSHOPR_SYNC_SECRET", originalRepairShoprSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/integrations/repairshopr/sync", {
      method: "POST",
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /secret/i);
});

test("rejects RepairShopr sync with the wrong secret", async (t) => {
  const originalRepairShoprSecret = process.env.REPAIRSHOPR_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  process.env.REPAIRSHOPR_SYNC_SECRET = "correct";
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("REPAIRSHOPR_SYNC_SECRET", originalRepairShoprSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/integrations/repairshopr/sync", {
      method: "POST",
      headers: { "x-repairshopr-sync-secret": "wrong" },
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /secret/i);
});

test("protects RepairShopr status details", async (t) => {
  const originalRepairShoprSecret = process.env.REPAIRSHOPR_SYNC_SECRET;
  process.env.REPAIRSHOPR_SYNC_SECRET = "correct";
  t.after(() => {
    restoreEnv("REPAIRSHOPR_SYNC_SECRET", originalRepairShoprSecret);
  });

  const response = await getStatus(
    new Request("http://localhost/api/integrations/repairshopr/status"),
  );

  assert.equal(response.status, 401);
});

test("protects the RepairShopr connection test", async (t) => {
  const originalRepairShoprSecret = process.env.REPAIRSHOPR_SYNC_SECRET;
  process.env.REPAIRSHOPR_SYNC_SECRET = "correct";
  t.after(() => {
    restoreEnv("REPAIRSHOPR_SYNC_SECRET", originalRepairShoprSecret);
  });

  const response = await testConnection(
    new Request("http://localhost/api/integrations/repairshopr/test", {
      method: "POST",
      headers: { "x-repairshopr-sync-secret": "wrong" },
    }),
  );

  assert.equal(response.status, 401);
});
