import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSyncroCustomers,
  extractSyncroTickets,
  getSyncroConfig,
  isSyncroRequestAuthorized,
  normalizeSyncroStatus,
  testSyncroConnection,
} from "./syncro";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("rejects other provider secrets and untrusted API hosts", (t) => {
  const keys = ["SYNCRO_SUBDOMAIN", "SYNCRO_API_KEY", "SYNCRO_SYNC_SECRET", "REPAIRSHOPR_SYNC_SECRET", "CRON_SECRET"];
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => restoreEnv(key, previous[index])));
  process.env.SYNCRO_SUBDOMAIN = "https://attacker.example";
  process.env.SYNCRO_API_KEY = "test-token";
  process.env.SYNCRO_SYNC_SECRET = "syncro-only";
  process.env.REPAIRSHOPR_SYNC_SECRET = "repair-only";
  delete process.env.CRON_SECRET;
  assert.equal(getSyncroConfig().configured, false);
  assert.equal(isSyncroRequestAuthorized(new Request("https://app.example", { headers: { "x-syncro-sync-secret": "repair-only" } })), false);
  assert.equal(isSyncroRequestAuthorized(new Request("https://app.example", { headers: { "x-syncro-sync-secret": "syncro-only" } })), true);
});

test("normalizes Syncro customers", () => {
  const customers = extractSyncroCustomers({
    customers: [
      {
        id: 42,
        business_name: "Decent Four",
        email: "ops@decent4.com",
        phone: "555-0100",
        updated_at: "2026-05-12T12:00:00Z",
      },
    ],
  });

  assert.equal(customers.length, 1);
  assert.equal(customers[0].id, "42");
  assert.equal(customers[0].name, "Decent Four");
  assert.equal(customers[0].email, "ops@decent4.com");
});

test("normalizes Syncro ticket identity, status, priority, and URL", () => {
  const tickets = extractSyncroTickets(
    {
      tickets: [
        {
          id: 99,
          number: 1234,
          subject: "Critical checkout workstation down",
          problem_type: "Workstation repair",
          comments: [{ body: "Customer cannot work and needs help ASAP." }],
          status: "In Progress",
          customer_id: 42,
          customer_business_then_name: "Decent Four",
          updated_at: "2026-05-12T12:05:00Z",
        },
      ],
    },
    "https://example.syncromsp.com/api/v1",
  );

  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, "99");
  assert.equal(tickets[0].number, "1234");
  assert.equal(tickets[0].status, "in_progress");
  assert.equal(tickets[0].priority, "P1");
  assert.equal(tickets[0].customerId, "42");
  assert.equal(tickets[0].customerEmail, null);
  assert.equal(tickets[0].description, "Customer cannot work and needs help ASAP.");
  assert.equal(tickets[0].url, "https://example.syncromsp.com/tickets/99");
});

test("maps Syncro done statuses out of the active queue", () => {
  assert.equal(normalizeSyncroStatus("Resolved"), "resolved");
  assert.equal(normalizeSyncroStatus("Closed"), "closed");
  assert.equal(normalizeSyncroStatus("Invoiced"), "closed");
  assert.equal(normalizeSyncroStatus("Not Closed"), "triaged");
});

test("extracts array payloads and skips malformed records", () => {
  const tickets = extractSyncroTickets([
    { id: "valid", subject: "Question about estimate", status: "New" },
    { subject: "missing id" },
  ]);

  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, "valid");
  assert.equal(tickets[0].status, "new");
});

test("keeps manual and cron secret configuration distinct", (t) => {
  const originalSyncSecret = process.env.SYNCRO_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  process.env.SYNCRO_SYNC_SECRET = "manual-secret";
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("SYNCRO_SYNC_SECRET", originalSyncSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const config = getSyncroConfig();
  assert.equal(config.syncSecretPresent, true);
  assert.equal(config.cronSecretPresent, false);
});

test("sends the API token in the Authorization header, not the URL", async (t) => {
  const originalSubdomain = process.env.SYNCRO_SUBDOMAIN;
  const originalApiKey = process.env.SYNCRO_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SYNCRO_SUBDOMAIN = "example";
  process.env.SYNCRO_API_KEY = "private-token";

  let requestedUrl = "";
  let requestedAuthorization: string | null = null;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get("authorization");
    return new Response(
      JSON.stringify({
        customers: [],
        meta: { page: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  t.after(() => {
    restoreEnv("SYNCRO_SUBDOMAIN", originalSubdomain);
    restoreEnv("SYNCRO_API_KEY", originalApiKey);
    globalThis.fetch = originalFetch;
  });

  await testSyncroConnection();

  assert.equal(new URL(requestedUrl).searchParams.has("api_key"), false);
  assert.equal(requestedAuthorization, "Bearer private-token");
});

test("falls back to the documented query authentication when needed", async (t) => {
  const originalSubdomain = process.env.SYNCRO_SUBDOMAIN;
  const originalApiKey = process.env.SYNCRO_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SYNCRO_SUBDOMAIN = "legacy-example";
  process.env.SYNCRO_API_KEY = "legacy-token";

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const requestUrl = String(input);
    requestedUrls.push(requestUrl);
    if (!new URL(requestUrl).searchParams.has("api_key")) {
      return new Response(null, { status: 401 });
    }
    return new Response(
      JSON.stringify({
        customers: [],
        meta: { page: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  t.after(() => {
    restoreEnv("SYNCRO_SUBDOMAIN", originalSubdomain);
    restoreEnv("SYNCRO_API_KEY", originalApiKey);
    globalThis.fetch = originalFetch;
  });

  await testSyncroConnection();

  assert.equal(requestedUrls.length, 3);
  assert.equal(new URL(requestedUrls[2]).pathname, "/api/v1/tickets");
  assert.equal(new URL(requestedUrls[0]).searchParams.has("api_key"), false);
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("api_key"),
    "legacy-token",
  );
});
