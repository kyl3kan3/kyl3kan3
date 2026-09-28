# Production activation and acceptance

The app implements the ticket → classification → routing → completion review → manager evidence workflow. It is not a replacement for the RepairShopr/Syncro technician interface: customer replies, attachments, worksheets, and status changes stay there. Source routing write-back exports only priority and technician IDs.

## Required configuration

- `DATABASE_URL`: live Neon database, initialized with `db/schema.sql`. Additive workflow migrations initialize automatically.
- `APP_ACCESS_PASSWORD`, `MANAGER_DASHBOARD_PASSWORD`: distinct, unique values of at least 16 characters before real customer data. The temporary `admin` password is not launch-ready. Shared sessions are role gates, not individual identity or SSO.
- `CRON_SECRET`: protects the scheduled imports, assessment processor, write-back processor, and operational alert processor.
- Jev: Vercel AI Gateway OIDC on Vercel, or `AI_GATEWAY_API_KEY`. Default model is `typesafe-ai/jev`.
- At least one of `REPAIRSHOPR_SUBDOMAIN` + `REPAIRSHOPR_API_KEY`, or `SYNCRO_SUBDOMAIN` + `SYNCRO_API_KEY`. Provide account-wide customer/ticket/detail/comment/user read permissions.
- Set and version company review procedures using `JEV_REVIEW_PROCEDURES_JSON` and `JEV_REVIEW_PROCEDURE_VERSION`. Defaults are documentation, customer next steps, and verification evidence.

Redeploy when changing server environment variables. Keys must never be pasted into source files or tickets. No provider webhook is required for the five-minute polling imports. Inbound email is separate and requires its own delivery/signing configuration.

## Manager setup

1. Sign in and open Settings → Production readiness. Check configuration and test live connections.
2. In Operations, test each configured source and import batches. Inspect failures; large backfills take multiple runs.
3. In the directory, assign imported technicians to appropriate local teams and set availability. Provider identity links are preserved. Directory roles do not grant login privileges under shared authentication.
4. Configure routing rules by issue type, urgency, and source. Lower order wins; the first active match supplies overrides. A rule cannot waive human triage. Existing human ownership and provider values are preserved.
5. Inspect queued Jev jobs, oldest outstanding age, and failed jobs. Retry failed jobs or request fresh triage when source routing conflicts occur.
6. Review the Quality page’s comparable cohorts and linked examples. Missing evidence is excluded from scoring, not assigned zero. Response time belongs to the ticket; it must not be assumed to be the final technician’s personal response time.

## Optional source routing writes

Leave source writes disabled until the import acceptance test passes. Set `*_WRITEBACK_PRIORITY_MAP` to a JSON object with P1, P2, P3, P4 keys and your account’s exact priority labels. Grant Tickets–Edit permission. Set the matching `*_WRITEBACK_ENABLED=true`. Keep `*_WRITEBACK_AUTO_APPROVE=false` for manager approval.

Approve a synthetic ticket’s proposal in Operations and process approved changes. Verify priority/technician in the source UI. Existing owners are not reassigned automatically. Missing identity mappings or account changes block the queue. Never reuse one database organization for a different provider subdomain.

Provider APIs do not expose a documented conditional-write token. The preflight version check minimizes, but cannot eliminate, a human edit racing between GET and PUT. Keep approval-first operation if that risk is unacceptable; leave writes disabled and apply recommendations manually for strict human control.

## Real-account acceptance test (requires keys)

1. Create a clearly synthetic ticket in the source account.
2. Import it and verify ID, customer, priority, timestamps, assignee, and complete comments match.
3. Process Jev triage. Confirm issue/urgency/team, rule chosen, workspace response deadline, and any human-review flag.
4. If writes are enabled, approve routing and verify the source changed exactly as approved. Change the source after another proposal; confirm the stale proposal reports a conflict rather than overwriting it.
5. Record diagnosis, work performed, verification results, and customer next steps in the source. Complete the ticket.
6. Import and process again. Confirm one completion cycle/review, correct owner snapshot, and evidence visible through completion only.
7. Replay an import. Confirm no duplicate completion, comment, review, or technician credit.
8. Reopen and recomplete the synthetic ticket. Confirm a new cycle, separate evidence, and reopened metrics.
9. Inspect in-app deadline/routing alerts and acknowledge one. Verify acknowledgment persists while the condition remains and resolves when cleared.

## Verification and known boundaries

Run `npm run check` locally. `scripts/smoke-production.mjs` checks deployed sign-in, role isolation, database-backed pages, live synthetic Jev classification/review, and protected workers. It does not mutate a real source ticket.

Real-account permissions and source payloads cannot be certified without credentials. Browser visual checks are separate from automated API/SQL tests. Individual SSO, outbound customer email, attachment/worksheet ingestion, and HR decision automation are not enabled. Jev assesses evidence; software calculates metrics; managers make employee decisions.
