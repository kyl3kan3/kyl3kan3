import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

function restoreEnv(
  key: "INBOUND_WEBHOOK_SECRET" | "RESEND_WEBHOOK_SECRET",
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
