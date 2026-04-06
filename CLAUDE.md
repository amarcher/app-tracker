# CLAUDE.md

## Project Overview

Unified observability dashboard monitoring traffic and API usage across 8+ web applications. Deployed at [app-traffic.vercel.app](https://app-traffic.vercel.app).

**Stack**: Vite 8 + React 19 + TypeScript + Recharts, Vercel serverless functions, Neon Postgres.

## Commands

- `npm run dev` — start dev server (use `vercel dev` for API routes)
- `npm run build` — `tsc -b && vite build`
- `npx tsc --noEmit` — type check

## Architecture

### Data Sources

1. **GA4 Data API** — Traffic metrics per project. Each project has its own GA4 property. A shared GCP service account (`ga4-reader@animal-penpals-dashboard.iam.gserviceaccount.com`) has Viewer access to all properties.

2. **ElevenLabs API** — Account-wide character usage and subscription info. Shown as a separate "ElevenLabs" view (not per-project, because the API doesn't support per-key filtering).

3. **Neon Postgres** (`api_usage` table) — Self-instrumented per-request API usage logged by each monitored project's server-side routes. Projects log to this table via `@neondatabase/serverless` with a fire-and-forget pattern.

4. **Cloudflare GraphQL Analytics API** — Per-project CDN stats for projects using Cloudflare (R2 video hosting). Shows bandwidth, cache hit ratio, requests (cached vs uncached), and R2 storage. Each project maps to a Cloudflare Zone ID. Only shown for projects with `cloudflare: true` in the PROJECTS config.

### API Routes (`api/`)

- `ga-traffic.ts` — Queries GA4 Data API. Accepts `?project=` to select the GA4 property. Property IDs are mapped from env vars in the `PROPERTIES` object.
- `elevenlabs-usage.ts` — Queries ElevenLabs usage stats and subscription info. Account-wide, not project-specific.
- `api-usage.ts` — Queries Neon Postgres for self-instrumented usage data. Accepts `?project=` to filter.
- `cloudflare-cdn.ts` — Queries Cloudflare GraphQL API for HTTP request stats (`httpRequests1dGroups`) and R2 storage (`r2StorageAdaptiveGroups`). Accepts `?project=` to select the zone. Zone IDs mapped from env vars. Only returns data for projects with Cloudflare zones configured.

### Frontend

- `App.tsx` — Project selector (8 projects + ElevenLabs account view), date range selector, conditional rendering based on selected view. Projects with `cloudflare: true` show a CDN section.
- `useDashboardData.ts` — Fetches only the relevant APIs based on whether a project or ElevenLabs is selected, and whether the project has Cloudflare.
- Components: `TrafficChart`, `TopPagesTable`, `SourcesTable`, `ElevenLabsChart`, `ProductBreakdown`, `QuotaBar`, `MetricCard`, `CdnChart`.

### Adding a New Project

1. Add GA4 property ID env var to Vercel (`GA4_PROPERTY_ID_<NAME>`)
2. Add entry to `PROPERTIES` in `api/ga-traffic.ts`
3. Add entry to `PROJECTS` in `src/App.tsx`
4. Deploy

The monitored project itself needs:
- GA4 gtag.js in index.html
- Service account granted Viewer access on its GA4 property
- `DASHBOARD_DATABASE_URL` env var (if it has API routes to instrument)
- `logUsage()` calls in server-side API routes

For projects using Cloudflare (R2 video CDN):
- Add `CLOUDFLARE_ZONE_ID_<NAME>` env var to Vercel
- Add entry to `ZONES` in `api/cloudflare-cdn.ts`
- Set `cloudflare: true` on the project entry in `src/App.tsx`

See `scripts/add-project.sh` for automation of some steps.

## Key Files

- `api/ga-traffic.ts` — GA4 Data API queries, project-to-property mapping
- `api/elevenlabs-usage.ts` — ElevenLabs usage + subscription
- `api/api-usage.ts` — Neon Postgres queries for self-instrumented data
- `src/App.tsx` — Main dashboard UI with project selector
- `src/hooks/useDashboardData.ts` — Data fetching hook
- `scripts/add-project.sh` — Helper for adding new projects

## Environment Variables

See `.env.example` for the full list. Key vars:
- `GA4_KEY_JSON` — Service account credentials (inline JSON for Vercel)
- `GA4_PROPERTY_ID*` — One per monitored project
- `ELEVENLABS_API_KEY` — For account-wide usage stats
- `DATABASE_URL` — Neon Postgres connection string
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token (Zone > Analytics > Read, Account > Workers R2 Storage > Read)
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID
- `CLOUDFLARE_ZONE_ID_*` — One per project using Cloudflare (e.g. `CLOUDFLARE_ZONE_ID_PERIODIC_TABLE`)

## Database Schema

```sql
CREATE TABLE api_usage (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  project TEXT NOT NULL,
  service TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  characters INTEGER DEFAULT 0,
  model TEXT,
  metadata JSONB DEFAULT '{}'
);
```

Indexed on `(project, timestamp)` and `(service, timestamp)`.
