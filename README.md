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

## API

- `GET /api/health`
- `GET /api/tickets`
- `POST /api/webhooks/inbound-email`

## Checks

```bash
npm run check
```
