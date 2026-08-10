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

5. **App Store Connect API + iTunes lookup** — iOS app stats for projects with `appStore: true` (currently Space Race). Public iTunes lookup provides rating/version with no auth; the ASC API (ES256 JWT from `ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_PRIVATE_KEY`) provides customer reviews; daily download units come from the Sales Reports API and additionally require `ASC_VENDOR_NUMBER`; daily active devices and sessions come from the Analytics Reports API. Each capability degrades gracefully when its env vars are missing. Note: sales/analytics report access depends on the API key's role — App Manager keys can read reviews but may not have Sales and Trends access.

   **Analytics Reports (daily active devices)** are opt-in per app: Apple generates nothing until an **Admin-role** key POSTs to `/v1/analyticsReportRequests`. A Sales and Reports key can *read* the reports but gets a 403 creating the request. Run `scripts/asc-analytics-request.mjs <appId>` once with an Admin key; reports appear within ~48h, then the route reads them with the Sales key (or `ASC_ANALYTICS_KEY_ID`/`ASC_ANALYTICS_PRIVATE_KEY` if set). Data lags ~1 day. Active devices come from the "App Sessions Standard" report's `Unique Devices` column, which Apple pre-aggregates per app version / device / territory / source — so the daily sum slightly over-counts devices that span several of those. Sessions are exact.

6. **Amazon Appstore** — Fire tablet stats for projects with `amazonAppstore: true` (currently Space Race). Amazon splits this across two sources and there is no way around it:

   - **Downloads** come from the **Appstore Reporting API** (`developer.amazon.com/api/appstore/download/report/sales/<year>/<month>`), authenticated with an LWA client-credentials token (`AMAZON_REPORTING_CLIENT_ID`/`_SECRET`, scope `adx_reporting::appstore:marketer`). The endpoint returns a presigned S3 URL — valid 5 minutes — to a **zipped** CSV; `unpackReport()` reads the zip by hand because Node ships zlib but no zip reader. A free app still books one transaction row per acquisition at price 0, which is exactly what the console's Units page counts, so summing app-type `Units` per day gives downloads.

   - **Installs and DAU/WAU/MAU have no API at all.** Amazon's docs state outright that acquisition and engagement reports cannot be downloaded through the Reporting API, and the 2026 "Reporting API Explorer" beta is **Vitals only** (crash/ANR/LMK). They exist solely as Download Center CSVs. `scripts/ingest-amazon-reports.mjs` loads those CSVs into the Neon table `amazon_appstore_stats`, and the route reads that table. Amazon's own lag is 72h for acquisition, 96h for engagement.

   The Acquisition *dashboard* in the console also warns it covers **only Fire TV**; Space Race is Fire-tablet-only, so trust the CSVs over that dashboard. Note that the Amazon build ships with **no analytics** (Amazon's child-directed COPPA policy), so these reports are the only usage signal that exists for it.

### API Routes (`api/`)

- `ga-traffic.ts` — Queries GA4 Data API. Accepts `?project=` to select the GA4 property. Property IDs are mapped from env vars in the `PROPERTIES` object. Returns engagement metrics (engagement rate, avg session duration, bounce rate, new vs returning users) alongside traffic.
- `portfolio-summary.ts` — Aggregates API usage and estimated costs across all projects from Neon. Returns per-project request counts, token/character totals, and cost estimates based on model pricing.
- `elevenlabs-usage.ts` — Queries ElevenLabs usage stats and subscription info. Account-wide, not project-specific.
- `api-usage.ts` — Queries Neon Postgres for self-instrumented usage data. Accepts `?project=` to filter.
- `cloudflare-cdn.ts` — Queries Cloudflare GraphQL API for HTTP request stats (`httpRequests1dGroups`) and R2 storage (`r2StorageAdaptiveGroups`). Accepts `?project=` to select the zone. Zone IDs mapped from env vars. Only returns data for projects with Cloudflare zones configured.
- `app-store.ts` — App Store stats (rating, version, reviews, daily downloads, daily active devices) for projects in its `APPS` map. Accepts `?project=`. See data source #5 for the env vars each capability needs.
- `amazon-appstore.ts` — Amazon Appstore stats for projects in its `APPS` map. Accepts `?project=`. Returns `downloads` (Reporting API, live) and `stats` (installs + DAU/WAU/MAU from ingested CSVs); each half degrades independently with a `reason`. See data source #6.

### Frontend

- `App.tsx` — Project selector (8 projects + Portfolio + ElevenLabs account views), date range selector, conditional rendering based on selected view. Projects with `cloudflare: true` show a CDN section. Traffic section shows engagement metrics (engagement rate, session duration, bounce rate, new users). API Usage section shows estimated costs.
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
- `scripts/ingest-amazon-reports.mjs` — Loads Amazon Download Center CSVs into `amazon_appstore_stats`

## Environment Variables

See `.env.example` for the full list. Key vars:
- `GA4_KEY_JSON` — Service account credentials (inline JSON for Vercel)
- `GA4_PROPERTY_ID*` — One per monitored project
- `ELEVENLABS_API_KEY` — For account-wide usage stats
- `AMAZON_REPORTING_CLIENT_ID` / `AMAZON_REPORTING_CLIENT_SECRET` — LWA security profile attached to the Reporting API (Developer Console > My Settings > API Access)
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

```sql
CREATE TABLE amazon_appstore_stats (
  project TEXT NOT NULL,
  date DATE NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'all',
  marketplace TEXT NOT NULL DEFAULT 'all',
  asin TEXT,
  app_name TEXT,
  daily_installs_unique INTEGER,
  daily_install_events INTEGER,
  current_user_installs INTEGER,
  dau INTEGER,
  wau INTEGER,
  mau INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project, date, device_type, marketplace)
);
```

Created on demand by `scripts/ingest-amazon-reports.mjs`. Acquisition and engagement
CSVs land on the same primary key and merge with `COALESCE`, so ingesting one does not
blank the other's columns, and re-ingesting a month is idempotent.
