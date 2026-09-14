# App Tracker

Unified observability dashboard for monitoring traffic, API usage, and costs across multiple web applications.

**Live**: [app-traffic.vercel.app](https://app-traffic.vercel.app)

## What It Does

- **Traffic** — Pageviews, sessions, users, top pages, and traffic sources per project via Google Analytics 4 Data API
- **API Usage** — Per-project Anthropic token consumption and ElevenLabs character usage, self-instrumented via Neon Postgres
- **ElevenLabs Account** — Account-wide character quota, product breakdown, and daily usage trends
- **App stores** — iOS downloads, active devices, rating and reviews via App Store Connect; Amazon Appstore downloads via the Appstore Reporting API, with installs and DAU/WAU/MAU ingested from Download Center CSVs
- **Our businesses** — private Fable book creation, paid finishes, printed copies, cash revenue, and separate Apple/Amazon download reports for Fable Reader and Space Race

## Monitored Projects

| Project | Domain | API Instrumentation |
|---|---|---|
| Animal Pen Pals | animalpenpals.tech | Anthropic + ElevenLabs TTS |
| Space Explorer | spaceexplorer.tech | — |
| Periodic Table | periodictable.tech | — |
| Crossword Clash | crosswordclash.com | Anthropic + ElevenLabs TTS |
| Delivery Picker | ticketfordinner.com | Anthropic |
| Superbowl Squares | superbowl-squares.com | — |
| Tabbit Rabbit | tabbitrabbit.com | Anthropic |
| Mark My Words | archer.biz | Anthropic + ElevenLabs TTS |
| Space Race | game.spaceexplorer.tech | App Store Connect + Amazon Appstore |
| Fable Designer / Fable Reader | fabledesigner.com | Fable aggregate feed + App Store Connect + Amazon Appstore |

## Architecture

- **Frontend**: Vite + React + TypeScript + Recharts
- **API Routes**: Vercel serverless functions querying GA4 Data API, ElevenLabs API, and Neon Postgres
- **Database**: Neon Postgres stores self-instrumented API usage logs from monitored projects
- **Deployment**: Vercel

## Adding a New Project

See `scripts/add-project.sh` or the SEO & Observability skill for the full checklist. In short:

1. Create a GA4 property and web data stream for the domain
2. Grant the shared service account Viewer access
3. Add the GA4 property ID as a Vercel env var
4. Add gtag.js to the project's index.html
5. Instrument any server-side API routes with the `logUsage` pattern
6. Add the project to `PROJECTS` in `src/App.tsx` and `PROPERTIES` in `api/ga-traffic.ts`

## Setup

```bash
cp .env.example .env
# Fill in API keys, property IDs, and database URL
npm install
vercel dev
```

Requires a GA4 service account key file (`ga4-key.json`) — see the SEO & Observability skill for setup instructions.

## Amazon Appstore reports

Downloads arrive through the Appstore Reporting API. Space Race uses the Aces Up Labs
account's `AMAZON_REPORTING_CLIENT_ID` / `AMAZON_REPORTING_CLIENT_SECRET`. Fable Reader
uses its separate Fable Designer LLC account's `FABLE_AMAZON_REPORTING_CLIENT_ID` /
`FABLE_AMAZON_REPORTING_CLIENT_SECRET`. Attach a Reporting API security profile in
each app's own developer account. A missing Fable pair does not reuse Space Race's
credentials; using the same client ID for both is rejected.

The history records the account configuration and ASIN with each observation. Legacy
Fable/Amazon observations collected with Space Race's account are excluded from totals
and cached responses; other verified store history is retained. Missing reports and
missing account connections remain unavailable, rather than becoming zero downloads.

Installs and active users have no Reporting API. Amazon's current [acquisition
reports](https://developer.amazon.com/docs/reports-promo/acquisition-reports.html)
cover Fire TV, so they do not supply installed-device counts for these Fire tablet
apps. [Engagement reports](https://developer.amazon.com/docs/reports-promo/engagement-reports.html)
can include Fire tablet active users, subject to Amazon's reporting lag and privacy
suppression. If a supported report is available in Download Center:

1. Developer Console > **My Reports > Download Center** > Acquisition Reports and
   Engagement Reports, and download the month you want.
2. `node scripts/ingest-amazon-reports.mjs --project fable-designer --dry-run ~/Downloads/report.csv`
3. Repeat without `--dry-run` to import. Use `--project space-race` for Space Race.

Both report types can go in one command, and re-ingesting a month is idempotent. Add
`--dry-run` to see what would be written.

The importer needs Node 22.18+ for the shared TypeScript app registry. Every row must
match the selected app's ASIN. Suppressed counts remain unavailable. Unique-user
segments cannot be added or reduced with MAX: the dashboard uses Amazon's explicit
all-device/all-marketplace rollup when present, otherwise it preserves segments
without inventing an account-wide unique total.

## Private business reporting

Open **Fable admin → Business → Open Our businesses**. A signed, five-minute POST
handoff creates a seven-day HttpOnly, Secure session cookie. Store keys and the
shared secret stay server-side. `/api/business` requires that session or a Bearer
`BUSINESS_METRICS_TOKEN`; unauthorized calls stop before database or provider access.
The same token is configured in Fable and this dashboard. Fable exposes only daily
aggregates at `/api/business-metrics`; no customer, child, book title, email, or
manuscript is copied. A branch preview uses its own Neon database.

Fable Reader belongs to Fable Designer LLC's Apple team. Its `FABLE_ASC_*` variables
are separate from Space Race's `ASC_*`; there is no cross-team fallback. Use a
Sales and Reports key for `*_SALES_KEY_ID` / `*_SALES_PRIVATE_KEY`. The public app
IDs and Amazon ASINs live in `api/_shared/store-apps.ts`.

The hourly cron runs at :15 with `CRON_SECRET`, saving a seven-day report and
upserting dated store rows. Repeated collection replaces a date rather than adding
it again. Tables are additive and initialized by authenticated collection.
`/api/business?action=household&range=7d` serves the cached report promptly; the
household token belongs in `~/.smart-home/business-metrics-token` on the render host.
The house labels stale reports and discards its last-good cache after 48 hours.
Other supported ranges are 1, 30 and 90 days; an authenticated `action=sync` can
backfill one of these ranges. History is labelled "recorded since", not lifetime.

Fable outcomes and cash use UTC dates and reuse the admin money ledger. Apple sales
reports use Pacific dates and count first acquisitions, with updates/redownloads
separate. Amazon sales units use UTC dates; they are downloads, not device installs.
Store cards use completed dates through yesterday, display their latest report date,
and mark incomplete coverage. Missing reports are unavailable, not zero. Amazon
install and engagement CSVs may lag by 72/96 hours and remain a separate source.

Validation: `npm run build`, `npm run lint`, and `npm test`. The tests cover exact
app attribution, report gaps, nullable values, importer filtering, auth boundaries,
signed handoffs, and bounded report concurrency.

### Fable Reader on Google Play

The private Businesses view and household feed collect Fable Reader's Google Play
install statistics with a dedicated service account (`FABLE_PLAY_KEY_JSON`). Grant
only **View app information and download bulk reports (read-only)** in the Fable
Designer Play Console account. Google requires this permission at account scope;
financial or publishing access is unnecessary. This connection does not fall back
to GA4, Apple, Amazon, or another app's credentials.

Set `FABLE_PLAY_REPORT_BUCKET` to the bucket copied from **Download reports →
Statistics → Copy Cloud Storage URI**. A newly published account may have no
exports or copy button yet; leave the setting unset until Google supplies it.
Only `stats/installs/installs_com.fabledesigner.reader_YYYYMM_country.csv` is read.
[Google documents the export format and 3–7 day delay](https://support.google.com/googleplay/android-developer/answer/6135870).

The card labels Google's **Daily User Installs** as user installs. Daily counts
are not deduplicated people across a week or month. The optional installed-device
figure is the latest day's **Installs on active devices** (devices online within
30 days), never a sum across days. Dates use Pacific time. Missing/suppressed days
remain pending, explicit reported zeroes remain zeroes, and source-tagged daily
history is replaced on repeat collections to accommodate revised exports.
