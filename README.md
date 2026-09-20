# Alert Triage

A Vercel + Neon incident triage console built from the MVP blueprint in `BLUEPRINT.md`.

## RepairShopr and Syncro integrations

Both providers support independent, import-only customer and ticket mirrors. Source IDs, customer records, sync locks, cursors, and run history are kept separate, so matching external ticket numbers do not collide. Incoming imports enqueue Jev triage; completion transitions enqueue evidence-based review. Ticket status must be changed in the original system, not in this console.

Configure each account in server environment variables (never paste API keys into client code):

| Provider | Account and API credentials | Manual sync secret |
| --- | --- | --- |
| RepairShopr | `REPAIRSHOPR_SUBDOMAIN`, `REPAIRSHOPR_API_KEY` | `REPAIRSHOPR_SYNC_SECRET` |
| Syncro | `SYNCRO_SUBDOMAIN`, `SYNCRO_API_KEY` | `SYNCRO_SYNC_SECRET` |

Use API credentials with customer and ticket read permissions. In Settings, enter the corresponding **sync secret**, test the connection, then run the initial sync. API keys remain server-side. Protected endpoints live under `/api/integrations/repairshopr` and `/api/integrations/syncro`: `GET /status`, `POST /test`, and `GET` or `POST /sync`. Manual requests accept the matching `x-repairshopr-sync-secret` or `x-syncro-sync-secret` header. Scheduled requests use `Authorization: Bearer <CRON_SECRET>`.

`vercel.json` schedules both mirrors every five minutes (requires a Vercel plan supporting that frequency). Configure `CRON_SECRET` before enabling scheduled runs. Each provider has independent `*_MAX_PAGES` and `*_FETCH_TIMEOUT_MS` controls; page-limit failures do not advance its cursor. Runtime initialization applies the Syncro schema automatically; `db/syncro.sql` is the equivalent explicit migration after `db/schema.sql`.

Limitations: this is not bidirectional synchronization or a guaranteed full-history import. Ticket summaries/initial comments may lack technician actions, verification, and customer next steps. No automatic mapping to employee identities is assumed. Missing evidence is flagged, and unattributed imported work is not assigned to an employee for scoring. Live account connectivity must be verified after credentials are configured.

API references: [RepairShopr](https://api-docs.repairshopr.com/) and [Syncro](https://api-docs.syncromsp.com/).

Production deployment also requires `APP_ACCESS_PASSWORD` and `MANAGER_DASHBOARD_PASSWORD`; do not deploy the protected build without configuring them.

## Technology

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

`AI_GATEWAY_API_KEY` enables Jev assessment through Vercel AI Gateway's TypeSafe-compatible API (`https://ai-gateway.vercel.sh/typesafe/v1/systemone`). Vercel's `VERCEL_OIDC_TOKEN` is also supported when no Gateway API key is set. Direct TypeSafe API keys are no longer used. See [Vercel's migration guide](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe). `JEV_MODEL` defaults to `typesafe-ai/jev`; pin a version in production when calibrated thresholds must remain stable. `JEV_TRIAGE_CONFIDENCE_THRESHOLD` controls when classification is sent to human triage, and `JEV_EVIDENCE_THRESHOLD` controls whether a completion-review dimension has enough evidence to score. The key is never exposed to the browser.

`JEV_REVIEW_PROCEDURES_JSON` supplies the company's completion procedures as either a JSON array used for every ticket or an object keyed by issue type with a `default` array. Set `JEV_REVIEW_PROCEDURE_VERSION` whenever the procedure changes. Each assessment snapshots the procedure text and version, and manager cohorts keep different model, rubric, and procedure versions separate.

`MANAGER_DASHBOARD_PASSWORD` is required in production for `/quality` and `/api/quality`; `MANAGER_DASHBOARD_USERNAME` defaults to `manager`. The page uses HTTP Basic authentication, while API clients may also send the password as a Bearer token. In development only, the manager view remains available when no password is configured.

`APP_ACCESS_PASSWORD` is required in production for the helpdesk pages and internal ticket, dashboard, team, and user APIs; `APP_ACCESS_USERNAME` defaults to `operator`. Provider webhooks, scheduled jobs, and RepairShopr endpoints keep their separate purpose-specific secrets. This shared workspace gate prevents public reads and writes, but it is not individual technician identity—connect your SSO/session provider before using actor identity for personnel decisions.

Ticket text is sent to TypeSafe for Jev assessment. The integration removes common credentials, bearer tokens, private keys, email addresses, SSNs, and payment-card digits before the external request, but operators must still avoid putting live secrets in tickets and must approve TypeSafe as a data processor for their environment.

`ALLOWED_INBOUND_RECIPIENT_DOMAINS` limits which receiving domains can create tickets. For this app, set it to `inbound.decent4.com` so mail for another domain or setup is rejected. `ALLOWED_INBOUND_RECIPIENTS` can optionally list exact allowed addresses.

`REPAIRSHOPR_SUBDOMAIN`, `REPAIRSHOPR_API_KEY`, and `REPAIRSHOPR_SYNC_SECRET` enable the RepairShopr mirror. The API key stays server-side, and the sync secret protects manual sync, connection tests, and status checks. On Vercel, set `CRON_SECRET` so scheduled requests can authenticate. `REPAIRSHOPR_MAX_PAGES` is a safety limit: if the provider reports more pages, the sync fails visibly instead of silently skipping records. The included five-minute schedule requires Vercel Pro; Hobby deployments must change it to a daily schedule.

## Functional surface

- Live Neon-backed dashboard metrics, ticket queue, team load, and incident stream.
- Manual ticket intake with priority, team, owner, reporter, and description fields.
- Ticket status, priority, team, and owner updates from the console.
- Ticket comments and timeline refresh.
- Inbound alert webhook that normalizes alert/email payloads, asks Jev for issue type, urgency, and suggested team, deduplicates incidents, and records assessment plus audit metadata.
- Local routing rules that turn Jev classification into queue, priority, owner, and response deadline; low-confidence or unavailable assessments remain in human triage.
- Completion evidence capture and a second Jev assessment for documentation, customer next steps, and required verification.
- Versioned, issue-type-specific company completion procedures supplied through server configuration and snapshotted with every review.
- A manager quality view that calculates response time, handled tickets, reopened tickets, evidence coverage, and evidence-scored quality for comparable technician role and issue-type cohorts.
- Provider-aware inbound intake for Resend, Postmark, SendGrid, Mailgun-style payloads, with routing into `alert_email` or `client_email` tickets based on recipients and content.
- RepairShopr ticket/customer mirror that pulls from RepairShopr into Neon for triage, dashboard, and archive views.

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/quality`
- `GET /api/tickets`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
- `POST /api/tickets/:id/comments`
- `POST /api/webhooks/inbound-email`
- `GET|POST /api/jobs/jev-assessments`
- `GET /api/integrations/repairshopr/status`
- `POST /api/integrations/repairshopr/test`
- `POST /api/integrations/repairshopr/sync`

The RepairShopr integration endpoints require either `Authorization: Bearer <REPAIRSHOPR_SYNC_SECRET>` or `x-repairshopr-sync-secret: <REPAIRSHOPR_SYNC_SECRET>`. Vercel cron calls use `Authorization: Bearer <CRON_SECRET>` automatically.

The Jev assessment retry job accepts `Authorization: Bearer <CRON_SECRET|JEV_JOB_SECRET>` or `x-jev-job-secret`. It retries transient provider failures without rolling back ticket intake or completion and reconciles tickets whose assessment record was not created during the original request.

## Inbound email setup

Recommended Vercel + Neon path:

1. Deploy the app to Vercel and set `DATABASE_URL` plus `AI_GATEWAY_API_KEY`. For generic providers set `INBOUND_WEBHOOK_SECRET`; for Resend set `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`.
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

Jev classifies the issue type, urgency, and best-fit team. Application rules—not Jev—map urgency to `P1` through `P4`, set the response deadline, and select an available owner. Low-confidence, conflicting, failed, or unconfigured assessments stay unassigned in the human-triage queue; the heuristic priority remains as a safe operational fallback.

When a technician resolves a ticket, the app records a completion cycle and captures three evidence fields. Jev then reviews documentation completeness, customer next steps, and required verification against the versioned procedure. Each dimension has a separate evidence-presence check. If evidence is missing, its score is stored as `null`, excluded from quality calculations, and reported as missing evidence rather than poor performance. Review history is limited to the current completion cycle, and the newest notes are retained on long tickets.

The protected `/quality` view keeps the responsibility boundary explicit: Jev assesses ticket artifacts, application code calculates metrics, and managers review examples and make coaching, workload, or employment decisions. Metrics are grouped by technician role, ticket issue type, Jev model, review rubric, and procedure version so unlike work is not compared directly. Database failures show no employee metrics rather than substituting demo employees. Technician attribution is the assigned ticket owner captured at completion; add your identity provider before treating that attribution as independently verified user identity.

Teams and users are managed from `/settings`. Users have a role, one team assignment, and an on-call flag; inbound assignment prefers on-call users with lower active ticket load.

## Checks

```bash
npm run check
```
