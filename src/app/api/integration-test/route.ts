import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { managerRequestFailure } from "@/lib/manager-request";

export const dynamic = "force-dynamic";

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getWebhookUrl(value: unknown, requestUrl: string) {
  const url = new URL(text(value, "/api/webhooks/inbound-email"), requestUrl);
  const app = new URL(process.env.APP_URL?.trim() || requestUrl);
  if (url.origin !== new URL(requestUrl).origin || url.origin !== app.origin
    || url.pathname !== "/api/webhooks/inbound-email"
    || url.search || url.hash || url.username || url.password) {
    throw new Error("Tests may only target this app's inbound-email webhook");
  }
  if (!["http:", "https:"].includes(url.protocol)
    || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("Production webhook tests must use https");
  }
  return url;
}

function defaultRecipientEmail() {
  const exactRecipient = text(process.env.ALLOWED_INBOUND_RECIPIENTS)
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);

  if (exactRecipient) return exactRecipient;

  const allowedDomain = text(process.env.ALLOWED_INBOUND_RECIPIENT_DOMAINS)
    .split(",")
    .map((entry) => entry.trim().replace(/^@/, ""))
    .find(Boolean);

  return `alerts@${allowedDomain || "inbound.decent4.com"}`;
}

export async function POST(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const webhookUrl = getWebhookUrl(payload.webhookUrl, request.url);
    const apiKey = text(payload.apiKey);
    const subject = text(payload.subject, "Integration smoke alert");
    const severity = text(payload.severity, "critical");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const headers = new Headers({
      "Content-Type": "application/json",
    });

    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`);
      headers.set("x-api-key", apiKey);
      headers.set("x-webhook-secret", apiKey);
    }

    const testPayload = {
      source: "integration-tester",
      id: `test-${randomUUID()}`,
      from: "integration-test@example.com",
      to: defaultRecipientEmail(),
      subject,
      body: "Smoke test generated from the console integration tester.",
      service: "console-integration",
      severity,
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(testPayload),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await response.text();
    const responseJson = parseJson(responseText);

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: response.status,
          error:
            responseJson?.error?.toString() ||
            response.statusText ||
            "Webhook test failed",
          response: responseJson ?? responseText.slice(0, 1200),
        },
        { status: 502 },
      );
    }

    const ticket =
      responseJson?.ticket && typeof responseJson.ticket === "object"
        ? (responseJson.ticket as Record<string, unknown>)
        : null;

    return NextResponse.json({
      ok: true,
      status: response.status,
      target: webhookUrl.toString(),
      ticketId:
        responseJson?.ticketId?.toString() ??
        ticket?.id?.toString() ??
        null,
      ticketNumber:
        responseJson?.ticketNumber?.toString() ??
        ticket?.ticket_number?.toString() ??
        ticket?.ticketNumber?.toString() ??
        null,
      priority: responseJson?.priority?.toString() ?? null,
      response: responseJson ?? responseText.slice(0, 1200),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Webhook test timed out"
        : error instanceof Error
          ? error.message
          : "Unable to test integration";

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
