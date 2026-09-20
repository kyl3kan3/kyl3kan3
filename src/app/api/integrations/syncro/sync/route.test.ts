import assert from "node:assert/strict";
import test from "node:test";
import { GET as getStatus } from "../status/route";
import { POST as testConnection } from "../test/route";
import { POST } from "./route";

function restoreEnv(key: "SYNCRO_SYNC_SECRET" | "CRON_SECRET", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("rejects Syncro sync without a configured secret", async (t) => {
  const originalSyncroSecret = process.env.SYNCRO_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  delete process.env.SYNCRO_SYNC_SECRET;
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("SYNCRO_SYNC_SECRET", originalSyncroSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/integrations/syncro/sync", {
      method: "POST",
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /secret/i);
});

test("rejects Syncro sync with the wrong secret", async (t) => {
  const originalSyncroSecret = process.env.SYNCRO_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  process.env.SYNCRO_SYNC_SECRET = "correct";
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("SYNCRO_SYNC_SECRET", originalSyncroSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/integrations/syncro/sync", {
      method: "POST",
      headers: { "x-syncro-sync-secret": "wrong" },
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /secret/i);
});

test("protects Syncro status details", async (t) => {
  const originalSyncroSecret = process.env.SYNCRO_SYNC_SECRET;
  process.env.SYNCRO_SYNC_SECRET = "correct";
  t.after(() => {
    restoreEnv("SYNCRO_SYNC_SECRET", originalSyncroSecret);
  });

  const response = await getStatus(
    new Request("http://localhost/api/integrations/syncro/status"),
  );

  assert.equal(response.status, 401);
});

test("protects the Syncro connection test", async (t) => {
  const originalSyncroSecret = process.env.SYNCRO_SYNC_SECRET;
  process.env.SYNCRO_SYNC_SECRET = "correct";
  t.after(() => {
    restoreEnv("SYNCRO_SYNC_SECRET", originalSyncroSecret);
  });

  const response = await testConnection(
    new Request("http://localhost/api/integrations/syncro/test", {
      method: "POST",
      headers: { "x-syncro-sync-secret": "wrong" },
    }),
  );

  assert.equal(response.status, 401);
});
