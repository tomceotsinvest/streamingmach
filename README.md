# Streaming Machine — v1 (Netflix UK)

A fully automated consumer guide to what's worth watching on Netflix in the UK, ranked by a daily survey of real viewers.

```
Netflix UK Top 10 (TV + films) ─► daily survey wave ─► Prolific study ─► respondents take /survey
        ▲                                                                         │
        └──── next day ◄── publish dashboard ◄── guardrails ◄── score ◄── weight ◄┘
```

One Next.js app does everything: the daily job (`/api/cron/daily`), the respondent survey (`/survey`) and the public dashboard (`/`).

## What's in the box

| Path | What it does |
| --- | --- |
| `src/lib/netflix.ts` | Downloads Netflix's official Top 10 TSV, keeps the UK rows, builds the title set (this week's 20 + last week's drop-outs) |
| `src/lib/questionnaire.ts` | Survey v1 — fixed wording and answer codes, so every daily wave is comparable |
| `src/app/survey/` | Respondent survey (mobile-first): screener → viewing grid with decoy title → follow-ups → up to 4 deep-dive ratings → profile + attention check |
| `src/lib/allocation.ts` | Gives each respondent the watched titles furthest from 100 ratings |
| `src/lib/prolific.ts` | Creates + publishes one Prolific study per day, stops stale ones |
| `src/lib/weighting.ts` | Rim weighting (raking) to UK adult targets, weights capped at 5× |
| `src/lib/scoring.ts` | Quality exclusions, Viewer Score + 95% margin, reach, completion, momentum, content profile, who-loves-it |
| `src/lib/pipeline.ts` | Daily orchestration with guardrails: if a check fails, publishing is held and the last good data stays live |
| `src/lib/match.ts` | "People like me" — re-weights ratings by similarity to the visitor, in the browser (no login, nothing stored server-side) |
| `src/lib/search.ts` | Natural-language search → structured filters (Claude if `ANTHROPIC_API_KEY` is set, rules otherwise) → ranked from the dataset. The model never names titles, so it can't invent shows |
| `db/schema.sql` | Postgres tables |
| `tests/` | 15 unit tests (`npm test`) |

## Run it locally (5 minutes, no accounts needed)

```bash
npm install
npm run demo     # builds public/demo-snapshot.json from synthetic respondents (fictional titles)
npm run dev      # http://localhost:3000 — dashboard with a "Demo data" banner
npm test
```

## Go live

### 1. Database — Supabase (free tier is fine to start)
1. Create a project at supabase.com (choose the London region).
2. Project settings → Database → Connection string → **Transaction pooler**. That's your `DATABASE_URL`.
3. `cp .env.example .env.local`, paste `DATABASE_URL`, then `npx tsx --env-file=.env.local scripts/db-init.ts`.

### 2. Hosting — Vercel
1. Push this folder to a GitHub repo and import it in Vercel.
2. Add every variable from `.env.example` in Vercel → Settings → Environment Variables. Set `APP_URL` to the Vercel URL and generate a random `CRON_SECRET`.
3. Deploy. `vercel.json` runs the daily job at 05:30 UTC.

### 3. Prolific setup
1. Sign up as a researcher at prolific.com and add funds.
2. Settings → API tokens → create a token → put it in `PROLIFIC_API_TOKEN` (Vercel only; never commit it).
3. Optional: create a project in Prolific and set `PROLIFIC_PROJECT_ID`.
4. **Eligibility:** restrict to UK residents. The filter IDs come from Prolific's filters list (`GET https://api.prolific.com/api/v1/filters/`). Put the filter array in `PROLIFIC_FILTERS_JSON`. The survey also screens out under-18s and anyone without Netflix, so a missing filter wastes money but never pollutes the data.
5. **Soft launch:** keep `PROLIFIC_AUTO_PUBLISH=false`. Trigger the job once:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/daily`
   It loads the chart and creates today's wave without paying anyone. Open `/survey?wave=<id>` and take it yourself.
6. Set `DAILY_COMPLETES=30`, `PROLIFIC_AUTO_PUBLISH=true`, run once, check the responses in Supabase, then raise to 175.

### 4. Natural-language search (optional)
Set `ANTHROPIC_API_KEY`. Without it, a keyword parser handles search.

## How the numbers work

- **Viewer Score (0–100)** = 50% average rating (rescaled) + 50% net recommend (rescaled). Each rating maps to a 0–100 composite whose weighted mean *is* the score, which gives an honest 95% margin.
- **Full score** at 100 ratings in the 7-day window; **Early** at 50–99; below 50 the title shows as New.
- **Excluded before weighting:** anyone claiming to have watched the fictional decoy title, failed attention check, identical answers on every grid, or under 40% of median completion time. They're still paid; they just don't count.
- **One response per person per 7 days**, so heavy survey-takers don't dominate.
- **Momentum (Trending)** = change in reach vs the previous 7 days + 50 × plan-to-watch share + 25 × word-of-mouth share.
- **Guardrails** hold publishing if: fewer than 300 valid completes in the window, over 25% excluded, or a scored title moves more than 15 points in a day. You get a Slack alert if `ALERT_WEBHOOK_URL` is set.

## Before launch — please check

- **Weighting targets** in `src/lib/weighting.ts` are approximate ONS/Census shares. Replace with current ONS mid-year estimates. Respondents are all Netflix users, so the better target is the UK Netflix-subscriber profile (e.g. BARB Establishment Survey); add it as `NETFLIX_SUBSCRIBER_TARGETS` when you have it.
- **Netflix feed:** the official chart updates weekly (Tuesdays). The survey runs daily against the latest week, plus last week's drop-outs.
- **Cost at defaults:** 175 completes/day × ~£1.20 reward + Prolific's platform fee.
