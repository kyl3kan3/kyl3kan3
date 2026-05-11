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
   - `alerts@...`, `incident@...`, `ops@...`, `noc@...` create `alert_email` tickets.
   - `support@...`, `client@...`, `help@...`, `ticket@...` create `client_email` tickets.

For Resend Inbound, create a receiving domain or use the provided `.resend.app` address, add a webhook for `email.received`, and use a subdomain if the root domain already has production mailbox MX records.

## Checks

```bash
npm run check
```
