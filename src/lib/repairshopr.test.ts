import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRepairShoprCustomers,
  extractRepairShoprTickets,
  getRepairShoprConfig,
  normalizeRepairShoprStatus,
  testRepairShoprConnection,
} from "./repairshopr";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("normalizes RepairShopr customers", () => {
  const customers = extractRepairShoprCustomers({
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

test("normalizes RepairShopr ticket identity, status, priority, and URL", () => {
  const tickets = extractRepairShoprTickets(
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
    "https://example.repairshopr.com/api/v1",
  );

  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, "99");
  assert.equal(tickets[0].number, "1234");
  assert.equal(tickets[0].status, "in_progress");
  assert.equal(tickets[0].priority, "P1");
  assert.equal(tickets[0].customerId, "42");
  assert.equal(tickets[0].customerEmail, null);
  assert.equal(tickets[0].description, "Customer cannot work and needs help ASAP.");
  assert.equal(tickets[0].url, "https://example.repairshopr.com/tickets/99");
});

test("maps RepairShopr done statuses out of the active queue", () => {
  assert.equal(normalizeRepairShoprStatus("Resolved"), "resolved");
  assert.equal(normalizeRepairShoprStatus("Closed"), "closed");
  assert.equal(normalizeRepairShoprStatus("Invoiced"), "closed");
  assert.equal(normalizeRepairShoprStatus("Not Closed"), "triaged");
});

test("extracts array payloads and skips malformed records", () => {
  const tickets = extractRepairShoprTickets([
    { id: "valid", subject: "Question about estimate", status: "New" },
    { subject: "missing id" },
  ]);

  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, "valid");
  assert.equal(tickets[0].status, "new");
});

test("keeps manual and cron secret configuration distinct", (t) => {
  const originalSyncSecret = process.env.REPAIRSHOPR_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  process.env.REPAIRSHOPR_SYNC_SECRET = "manual-secret";
  delete process.env.CRON_SECRET;
  t.after(() => {
    restoreEnv("REPAIRSHOPR_SYNC_SECRET", originalSyncSecret);
    restoreEnv("CRON_SECRET", originalCronSecret);
  });

  const config = getRepairShoprConfig();
  assert.equal(config.syncSecretPresent, true);
  assert.equal(config.cronSecretPresent, false);
});

test("sends the API token in the Authorization header, not the URL", async (t) => {
  const originalSubdomain = process.env.REPAIRSHOPR_SUBDOMAIN;
  const originalApiKey = process.env.REPAIRSHOPR_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.REPAIRSHOPR_SUBDOMAIN = "example";
  process.env.REPAIRSHOPR_API_KEY = "private-token";

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
    restoreEnv("REPAIRSHOPR_SUBDOMAIN", originalSubdomain);
    restoreEnv("REPAIRSHOPR_API_KEY", originalApiKey);
    globalThis.fetch = originalFetch;
  });

  await testRepairShoprConnection();

  assert.equal(new URL(requestedUrl).searchParams.has("api_key"), false);
  assert.equal(requestedAuthorization, "private-token");
});

test("falls back to the documented query authentication when needed", async (t) => {
  const originalSubdomain = process.env.REPAIRSHOPR_SUBDOMAIN;
  const originalApiKey = process.env.REPAIRSHOPR_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.REPAIRSHOPR_SUBDOMAIN = "legacy-example";
  process.env.REPAIRSHOPR_API_KEY = "legacy-token";

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
    restoreEnv("REPAIRSHOPR_SUBDOMAIN", originalSubdomain);
    restoreEnv("REPAIRSHOPR_API_KEY", originalApiKey);
    globalThis.fetch = originalFetch;
  });

  await testRepairShoprConnection();

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]).searchParams.has("api_key"), false);
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("api_key"),
    "legacy-token",
  );
});
