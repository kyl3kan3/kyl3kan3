# Alert Triage

A Vercel + Neon incident triage console built from the MVP blueprint in `BLUEPRINT.md`.

## Stack

- Next.js App Router
- Vercel deployment target
- Neon Postgres via `@neondatabase/serverless`
- Tailwind CSS

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Apply `db/schema.sql` to a Neon database, then set `DATABASE_URL` in `.env.local` and in Vercel project environment variables.

The app is build-safe without `DATABASE_URL`; it falls back to demo data until Neon is configured.

`INBOUND_WEBHOOK_SECRET` is optional during development. When set, inbound webhook calls must include either `Authorization: Bearer <secret>` or `x-webhook-secret: <secret>`.

`RESEND_API_KEY` is optional unless you use Resend Inbound. Resend sends the `email.received` webhook with message metadata first; when this key is set, the app fetches the received email body before creating or updating the ticket.

`RESEND_WEBHOOK_SECRET` is recommended for Resend Inbound. When Resend's `svix-*` headers are present, the app verifies the raw webhook body before processing it.

`OPENAI_API_KEY` enables AI reading and assignment for inbound alert/client emails. `OPENAI_TRIAGE_MODEL` defaults to `gpt-5-mini`; when the key is missing or the model response is invalid, the webhook still creates assigned tickets with deterministic fallback routing.

`ALLOWED_INBOUND_RECIPIENT_DOMAINS` limits which receiving domains can create tickets. For this app, set it to `inbound.decent4.com` so mail for another domain or setup is rejected. `ALLOWED_INBOUND_RECIPIENTS` can optionally list exact allowed addresses.

## Functional surface

- Live Neon-backed dashboard metrics, ticket queue, team load, and incident stream.
- Manual ticket intake with priority, team, owner, reporter, and description fields.
- Ticket status, priority, team, and owner updates from the console.
- Ticket comments and timeline refresh.
- Inbound alert webhook that normalizes alert/email payloads, uses AI to summarize/classify/assign them, deduplicates incidents, creates or updates tickets, and records raw alerts plus audit metadata.
- Provider-aware inbound intake for Resend, Postmark, SendGrid, Mailgun-style payloads, with routing into `alert_email` or `client_email` tickets based on recipients and content.

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/tickets`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
- `POST /api/tickets/:id/comments`
- `POST /api/webhooks/inbound-email`

## Inbound email setup

Recommended Vercel + Neon path:

1. Deploy the app to Vercel and set `DATABASE_URL` plus `OPENAI_API_KEY`. For generic providers set `INBOUND_WEBHOOK_SECRET`; for Resend set `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`.
2. In Neon, apply `db/schema.sql`. Use the pooled Neon connection string for `DATABASE_URL` in Vercel.
3. In your email provider, point inbound webhooks to:

```text
https://<your-vercel-domain>/api/webhooks/inbound-email
```

4. Secure provider webhooks with either `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>` or `x-webhook-secret: <INBOUND_WEBHOOK_SECRET>`. Resend uses its webhook signing secret instead, so copy that value into `RESEND_WEBHOOK_SECRET`.
5. Route addresses by mailbox name:
   - `alerts@inbound.decent4.com`, `incident@inbound.decent4.com`, `ops@inbound.decent4.com`, `noc@inbound.decent4.com` create `alert_email` tickets.
   - `support@inbound.decent4.com`, `client@inbound.decent4.com`, `help@inbound.decent4.com`, `ticket@inbound.decent4.com` create `client_email` tickets.

For Resend Inbound, create a receiving domain or use the provided `.resend.app` address, add a webhook for `email.received`, and use a subdomain if the root domain already has production mailbox MX records.

## Live intake and priority

The production webhook is always available at:

```text
https://kyl3kan3.vercel.app/api/webhooks/inbound-email
```

There is no polling worker to keep awake. The email provider calls this URL whenever a new inbound email or alert arrives, and Vercel runs the function on demand.

Priority is decided from two scores:

- Importance: customer/payment/checkout/security/compliance/high-priority language.
- Urgency: critical/P1/high-priority/immediate/urgent/asap/spike/5xx/repeat language.

Those scores map to `P1` through `P4`, set the SLA due time, and feed AI assignment. When `OPENAI_API_KEY` is set, AI can refine the title, summary, priority, team, owner, and deduplication hint. When AI is missing or fails, the deterministic scorer still creates and routes the ticket.

Teams and users are managed from `/settings`. Users have a role, one team assignment, and an on-call flag; inbound assignment prefers on-call users with lower active ticket load.

## Checks

```bash
npm run check
```
