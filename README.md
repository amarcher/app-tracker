# App Tracker

Unified observability dashboard for monitoring traffic, API usage, and costs across multiple web applications.

**Live**: [app-traffic.vercel.app](https://app-traffic.vercel.app)

## What It Does

- **Traffic** — Pageviews, sessions, users, top pages, and traffic sources per project via Google Analytics 4 Data API
- **API Usage** — Per-project Anthropic token consumption and ElevenLabs character usage, self-instrumented via Neon Postgres
- **ElevenLabs Account** — Account-wide character quota, product breakdown, and daily usage trends

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
