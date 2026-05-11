import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

function restoreEnv(
  key:
    | "ALLOWED_INBOUND_RECIPIENT_DOMAINS"
    | "ALLOWED_INBOUND_RECIPIENTS"
    | "DATABASE_URL"
    | "INBOUND_WEBHOOK_SECRET"
    | "OPENAI_API_KEY"
    | "RESEND_WEBHOOK_SECRET",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("rejects invalid generic JSON webhook payloads with 400", async (t) => {
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret));

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /json|unexpected|expected|valid/i);
});

test("rejects invalid signed Svix JSON webhook payloads with 400", async (t) => {
  const originalSvixSecret = process.env.RESEND_WEBHOOK_SECRET;
  const secret = "test-resend-secret";
  const id = "msg_test_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "{";
  const signature = createHmac("sha256", Buffer.from(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  process.env.RESEND_WEBHOOK_SECRET = secret;
  t.after(() => restoreEnv("RESEND_WEBHOOK_SECRET", originalSvixSecret));

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body: rawBody,
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /json|unexpected|expected|valid/i);
});

test("treats high priority immediate email language as P1 without AI", async (t) => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@example.com",
        subject: "High Priority Test",
        body: "High Priority Test Please Place this in the need to fix immediately.",
      }),
    }),
  );
  const body = (await response.json()) as {
    priority?: string;
    ai?: { usedAi?: boolean; fallbackReason?: string | null };
  };

  assert.equal(response.status, 202);
  assert.equal(body.priority, "P1");
  assert.equal(body.ai?.usedAi, false);
  assert.equal(body.ai?.fallbackReason, "missing_openai_api_key");
});

test("rejects email sent to a recipient outside the allowed inbound domain", async (t) => {
  const originalAllowedDomains = process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS;
  const originalAllowedRecipients = process.env.ALLOWED_INBOUND_RECIPIENTS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS = "inbound.decent4.com";
  delete process.env.ALLOWED_INBOUND_RECIPIENTS;
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("ALLOWED_INBOUND_RECIPIENT_DOMAINS", originalAllowedDomains);
    restoreEnv("ALLOWED_INBOUND_RECIPIENTS", originalAllowedRecipients);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@wrong-domain.example",
        subject: "Wrong inbound route",
        body: "This should not become a ticket here.",
      }),
    }),
  );
  const body = (await response.json()) as {
    ok?: boolean;
    error?: string;
    allowedDomains?: string[];
  };

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Inbound recipient is not allowed for this app");
  assert.deepEqual(body.allowedDomains, ["inbound.decent4.com"]);
});

test("accepts email sent to the allowed inbound domain", async (t) => {
  const originalAllowedDomains = process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS;
  const originalAllowedRecipients = process.env.ALLOWED_INBOUND_RECIPIENTS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;
  process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS = "inbound.decent4.com";
  delete process.env.ALLOWED_INBOUND_RECIPIENTS;
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  t.after(() => {
    restoreEnv("ALLOWED_INBOUND_RECIPIENT_DOMAINS", originalAllowedDomains);
    restoreEnv("ALLOWED_INBOUND_RECIPIENTS", originalAllowedRecipients);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
    restoreEnv("INBOUND_WEBHOOK_SECRET", originalInboundSecret);
  });

  const response = await POST(
    new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "customer@example.com",
        to: "alerts@inbound.decent4.com",
        subject: "Allowed inbound route",
        body: "This belongs in this app.",
      }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean; ticketId?: string };

  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.ok(body.ticketId);
});
