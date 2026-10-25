# Downwind Ground School

A scenario-based ground school and flight review prep app for private pilots. Every lesson starts with a real decision about a real flight, built from live weather, your own airplane and your home airport (all set up on first launch; nothing is assumed), and scored against the FAA Private Pilot ACS (FAA-S-ACS-6C).

> Training aid. Not for navigation. Not a substitute for an official weather briefing, your POH, or a CFI.

## Phase 0

- **Setup.** First launch asks for your home airport (looked up from aviationweather.gov, every value editable), your airplane (from a template or blank, with numbers from your POH) and your personal minimums.
- **Today.** A go/no-go decision at your home airport from the live METAR and TAF. It converts the true METAR wind to magnetic, picks the runway, computes steady and gust crosswind, density altitude, and weight and balance, then checks everything against VFR minimums, your airplane's demonstrated crosswind, and your personal minimums. You commit to a decision with a confidence rating before the debrief.
- **Airplane.** An aircraft profile and loading sheet with a CG envelope chart. Templates provide sample numbers to start from; the app labels them as samples until you replace them from your POH and weight and balance record.
- **Review.** ACS Area I questions scheduled with FSRS spaced repetition. Correctness and confidence together pick the review interval.
- **Readiness.** Per-ACS-task mastery, including how often you were confidently wrong.

Every grade comes from deterministic code in `src/scenarios` and `src/lib`, which a CFI can read and audit. No language model is involved in Phase 0.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173, with /api/awc proxied to aviationweather.gov
npm test
npm run build
```

When weather can't be fetched, the app falls back to clearly labeled practice weather, which is not a real report.

## Layout

| Path | What's there |
| --- | --- |
| `src/lib` | METAR and TAF parsing, wind components, density altitude, weight and balance, storage |
| `src/scenarios` | Scenario engines. `goNoGo.ts` builds the brief, findings and grades |
| `src/review` | ACS-tagged review items and the FSRS scheduler |
| `src/data` | Aircraft, airport and pilot profiles, and sample weather |
| `src/ui` | Screens and components |
| `src/ask` | Ask the instructor: the context a question carries, the system prompt, and reply checks |
| `worker` | Cloudflare Worker that proxies and caches aviationweather.gov and the FAA handbooks, and answers `/api/ask` |

## Ask the instructor

In any lesson step the pilot can type a question and get a short answer from the instructor. The app sends the lesson, the step on screen, the home field, the airplane, the personal minimums and any report in view; until the pilot checks their numbers or commits a decision, answers and grades are left out, so the model cannot give them away. The model (Claude, through the worker) explains; it never grades and never computes a number the lesson didn't show. It cites only labels the reference resolver opens (`src/refs/resolve.ts`), and the app drops any other.

It is off unless the worker has an Anthropic API key. With no key, or no worker (as in `npm run dev`), the feature does not appear.

```sh
cd worker
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when asked
npx wrangler deploy
```

Optional worker variables: `ASK_ORIGINS` (comma-separated origins allowed to ask, such as your app's URL; recommended once deployed so others can't spend your key) and `ASK_MODEL` (overrides the default `claude-haiku-5-5`). `wrangler.toml` binds a rate limit of 6 questions a minute per address. If the app is served from another origin than the worker, build it with `VITE_ASK_BASE=https://<worker>/api/ask`. To try it locally, run `npx wrangler dev` in `worker/` with the key in `worker/.dev.vars` (`ANTHROPIC_API_KEY=...`) and start the app with `VITE_ASK_BASE=http://localhost:8787/api/ask npm run dev`.

Cost is kept low: the cheapest current model (Claude Haiku 5.5) with thinking off and low effort, a system prompt that is identical on every request and prompt-cached, a context of one step with long text clipped, answers capped at 400 tokens, the same question on the same step served from the edge cache for a day, and a limit of 30 questions a day per device. A typical question is about 1,400 input tokens and 150 output tokens, roughly $0.0002.

## Data sources

- Weather: [aviationweather.gov Data API](https://aviationweather.gov/data/api/) (public, no key)
- Regulations and references: 14 CFR, the AIM, and FAA handbooks (PHAK, AFH, Aviation Weather Handbook, Risk Management Handbook), all public domain
- Planned: FAA VFR raster charts and NASR data for New England, and ADS-B traffic from adsb.lol (ODbL)

Airports bundled in `src/data/airports.ts` exist only so lookup works offline; they are not defaults. Each carries a list of fields to check against the current Chart Supplement until NASR import lands.

## Smoke test

`e2e/smoke.mjs` drives the built app in Chromium through onboarding, Today (brief, decide, debrief), Airplane, Review, Readiness and Settings, at iPad and phone widths, once with stubbed live weather and once offline. It checks for horizontal scroll and console errors on every screen.

```sh
npm run build && npx vite preview --port 4173 &
npm run smoke
```

It needs Playwright with Chromium available (`npm i -D playwright && npx playwright install chromium` if you don't have it).
