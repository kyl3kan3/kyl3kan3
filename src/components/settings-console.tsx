"use client";

import {
  ArrowLeft,
  Database,
  Layers3,
  RadioTower,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useState, useTransition } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

function SelectField({
  labelText,
  value,
  onChange,
  children,
  disabled,
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
      {labelText}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field h-10 w-full min-w-0 px-3 text-sm font-medium normal-case tracking-normal text-stone-900 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
      >
        {children}
      </select>
    </label>
  );
}

function TextField({
  labelText,
  value,
  onChange,
  placeholder,
  inputRef,
  type = "text",
}: {
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  type?: "email" | "password" | "text" | "url";
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
      {labelText}
      <input
        type={type}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field h-10 w-full min-w-0 px-3 text-sm normal-case tracking-normal text-stone-900 placeholder:text-stone-400"
      />
    </label>
  );
}

const exampleProviders = [
  {
    id: "generic",
    label: "Generic webhook",
    payload: {
      source: "monitor",
      id: "alert-123",
      from: "alerts@example.com",
      subject: "Checkout latency above threshold",
      body: "Customer-facing checkout latency is breaching SLA.",
      service: "checkout-api",
      severity: "critical",
    },
  },
  {
    id: "resend",
    label: "Resend (email.received)",
    payload: {
      type: "email.received",
      data: {
        email_id: "rs_test_123",
        from: "alerts@example.com",
        to: ["alerts@yourdomain.com"],
        subject: "Checkout latency above threshold",
        text: "Customer-facing checkout latency is breaching SLA.",
      },
    },
  },
];

export function SettingsConsole() {
  const [integrationTest, setIntegrationTest] = useState({
    webhookUrl: "",
    apiKey: "",
    subject: "Integration smoke alert",
  });
  const [exampleId, setExampleId] = useState(exampleProviders[0].id);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runMutation(action: () => Promise<string | void>) {
    setNotice(null);
    startTransition(async () => {
      try {
        const message = await action();
        if (message) setNotice(message);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  async function copyText(value: string, labelText: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = value;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setNotice(`${labelText} copied`);
    } catch {
      setNotice(`${labelText}: ${value}`);
    }
  }

  async function checkHealth() {
    const response = await fetch("/api/health", { cache: "no-store" });
    const result = (await response.json()) as {
      ok?: boolean;
      database?: string;
      error?: string;
    };

    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Health check failed");
    }

    return `Health ok: database ${result.database ?? "unknown"}`;
  }

  async function testIntegration() {
    const response = await fetch("/api/integration-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrationTest),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      status?: number;
      ticketNumber?: string | null;
    };

    if (!response.ok || !result.ok) {
      const status = result.status ? ` (${result.status})` : "";
      throw new Error(`${result.error ?? "Integration test failed"}${status}`);
    }

    return result.ticketNumber
      ? `Test alert created TK-${result.ticketNumber}`
      : "Webhook test accepted";
  }

  function submitIntegrationTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation(testIntegration);
  }

  function copyWebhookUrl() {
    void copyText(
      `${window.location.origin}/api/webhooks/inbound-email`,
      "Webhook URL",
    );
  }

  function copyExamplePayload() {
    const example =
      exampleProviders.find((entry) => entry.id === exampleId) ??
      exampleProviders[0];
    void copyText(
      JSON.stringify(example.payload, null, 2),
      `${example.label} payload`,
    );
  }

  return (
    <main className="min-h-screen text-stone-900">
      <header className="glass-header sticky top-0 z-20 border-b border-stone-200/70">
        <div className="mx-auto flex max-w-[920px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/"
              className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-3.5 text-[12.5px] font-semibold"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </a>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Alert Triage
              </p>
              <h1 className="truncate text-[22px] font-semibold tracking-tight text-stone-950">
                Settings
              </h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => runMutation(checkHealth)}
            disabled={isPending}
            className="btn-soft inline-flex h-10 items-center justify-center gap-2 rounded-full px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            Check database
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-[920px] gap-6 px-4 py-8 sm:px-6">
        <article className="surface-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md ring-1 ring-black/10">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                Inbound webhook
              </h2>
              <p className="text-[12.5px] text-stone-500">
                Point your provider at this URL to receive alerts.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <code className="surface-inset block overflow-x-auto px-3 py-2 font-mono text-[12px] text-stone-800">
              POST /api/webhooks/inbound-email
            </code>
            <button
              type="button"
              onClick={copyWebhookUrl}
              className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold"
            >
              <Send className="h-4 w-4" />
              Copy URL
            </button>
          </div>
          <p className="mt-3 text-[12.5px] text-stone-500">
            Authenticate with{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11.5px]">
              Authorization: Bearer &lt;INBOUND_WEBHOOK_SECRET&gt;
            </code>{" "}
            or the{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11.5px]">
              x-webhook-secret
            </code>{" "}
            header. Resend providers use Svix headers and{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11.5px]">
              RESEND_WEBHOOK_SECRET
            </code>
            .
          </p>
        </article>

        <article className="surface-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-md ring-1 ring-amber-600/20">
              <RadioTower className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                Send a test alert
              </h2>
              <p className="text-[12.5px] text-stone-500">
                Posts a synthetic alert to your webhook.
              </p>
            </div>
          </div>
          <form
            onSubmit={submitIntegrationTest}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <TextField
                labelText="Webhook URL"
                value={integrationTest.webhookUrl}
                onChange={(value) =>
                  setIntegrationTest((next) => ({ ...next, webhookUrl: value }))
                }
                placeholder="/api/webhooks/inbound-email"
              />
            </div>
            <TextField
              labelText="API key or secret"
              type="password"
              value={integrationTest.apiKey}
              onChange={(value) =>
                setIntegrationTest((next) => ({ ...next, apiKey: value }))
              }
              placeholder="Optional"
            />
            <TextField
              labelText="Test subject"
              value={integrationTest.subject}
              onChange={(value) =>
                setIntegrationTest((next) => ({ ...next, subject: value }))
              }
              placeholder="Integration smoke alert"
            />
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary sm:col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
            >
              <RadioTower className="h-4 w-4" />
              Send test alert
            </button>
          </form>
        </article>

        <article className="surface-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-md ring-1 ring-black/10">
              <Layers3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-950">
                Example payloads
              </h2>
              <p className="text-[12.5px] text-stone-500">
                Copy a sample to test from a CLI or a provider sandbox.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField
              labelText="Provider"
              value={exampleId}
              onChange={setExampleId}
            >
              {exampleProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </SelectField>
            <div className="flex items-end">
              <button
                type="button"
                onClick={copyExamplePayload}
                className="btn-soft inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold"
              >
                <Send className="h-4 w-4" />
                Copy payload
              </button>
            </div>
          </div>
          <pre className="surface-inset mt-3 max-h-72 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 text-stone-800">
            {JSON.stringify(
              (
                exampleProviders.find((entry) => entry.id === exampleId) ??
                exampleProviders[0]
              ).payload,
              null,
              2,
            )}
          </pre>
        </article>
      </section>

      {notice ? (
        <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-stone-200 bg-white/95 px-4 py-3 text-sm font-semibold text-stone-800 shadow-[0_24px_48px_-24px_rgba(20,14,5,0.45)] backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-pulse" />
            {notice}
          </div>
        </div>
      ) : null}
    </main>
  );
}
