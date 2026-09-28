import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { getDashboardData } from "./dashboard";
import { addTicketComment, createTeam, createTicket, createUser, updateTicket } from "./operations";
import { DatabaseUnavailableError } from "./runtime-mode";
import { getManagerQualityData } from "./quality-dashboard";

test("production never reads or mutates process-local demo data", async (t) => {
  const env: Record<string, string | undefined> = process.env;
  const keys = ["DATABASE_URL", "NODE_ENV", "VERCEL"];
  const before = keys.map(key => env[key]);
  t.after(() => keys.forEach((key, index) => {
    if (before[index] === undefined) delete env[key]; else env[key] = before[index];
  }));
  delete env.DATABASE_URL;
  env.NODE_ENV = "production";
  delete env.VERCEL;

  const operations = [
    () => getDashboardData(),
    () => getManagerQualityData(),
    () => createTeam({ name: "Must not persist" }),
    () => createUser({ email: "nobody@example.invalid", role: "agent", isOnCall: false }),
    () => createTicket({ title: "Must not become a fake ticket" }),
    () => updateTicket("not-real", { status: "resolved" }),
    () => addTicketComment("not-real", { body: "Must not become a fake comment" }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation(), DatabaseUnavailableError);
  }
  env.NODE_ENV = "test";
  env.VERCEL = "1";
  await assert.rejects(getDashboardData(), DatabaseUnavailableError);
  delete env.VERCEL;
  assert.equal((await getDashboardData()).source, "demo", "local development may still use explicit missing-DB demo mode");
});

test("a configured database failure never falls back to demo data or exposes driver details", async (t) => {
  const previous = process.env.DATABASE_URL;
  const previousFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://test:test@test.invalid/test";
  neonConfig.fetchFunction = async () => Response.json({ message: "private upstream database detail" }, { status: 500 });
  t.after(() => {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    neonConfig.fetchFunction = previousFetch;
  });
  await assert.rejects(getDashboardData(), (error: unknown) => {
    assert.ok(error instanceof DatabaseUnavailableError);
    assert.equal(error.message.includes("private upstream"), false);
    return true;
  });
  const quality = await getManagerQualityData();
  assert.equal(quality.source, "database");
  assert.equal(quality.rows.length, 0);
  assert.equal(quality.dbError?.includes("private upstream"), false);
});
