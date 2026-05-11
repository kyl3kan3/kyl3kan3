import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

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

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }

  const match172 = host.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return /^192\.168\./.test(host);
}

function getWebhookUrl(value: unknown, requestUrl: string) {
  const url = new URL(text(value, "/api/webhooks/inbound-email"), requestUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https");
  }

  if (process.env.NODE_ENV === "production") {
    if (url.protocol !== "https:") {
      throw new Error("Production webhook tests must use https");
    }

    if (isPrivateHost(url.hostname)) {
      throw new Error("Private network webhook URLs are blocked in production");
    }
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
