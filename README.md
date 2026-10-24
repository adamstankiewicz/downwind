# Downwind Ground School

A scenario-based ground school and flight review prep app for private pilots. Every lesson starts with a real decision about a real flight, built from live weather, your own airplane and your home airport, and scored against the FAA Private Pilot ACS (FAA-S-ACS-6C).

> Training aid. Not for navigation. Not a substitute for an official weather briefing, your POH, or a CFI.

## Phase 0

- **Today at KASH.** A go/no-go decision from the live METAR and TAF. It converts the true METAR wind to magnetic, picks the runway, computes steady and gust crosswind, density altitude, and weight and balance, then checks everything against VFR minimums, your airplane's demonstrated crosswind, and your personal minimums. You commit to a decision with a confidence rating before the debrief.
- **Airplane.** An aircraft profile and loading sheet with a CG envelope chart. It ships with sample C172K-shaped numbers that you replace from your POH and weight and balance record.
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

When weather can't be fetched, the app falls back to clearly labeled sample data.

## Layout

| Path | What's there |
| --- | --- |
| `src/lib` | METAR and TAF parsing, wind components, density altitude, weight and balance, storage |
| `src/scenarios` | Scenario engines. `goNoGo.ts` builds the brief, findings and grades |
| `src/review` | ACS-tagged review items and the FSRS scheduler |
| `src/data` | Aircraft, airport and pilot profiles, and sample weather |
| `src/ui` | Screens and components |
| `worker` | Cloudflare Worker that proxies and caches aviationweather.gov, and reserves `/api/llm` for a future model gateway |

## Data sources

- Weather: [aviationweather.gov Data API](https://aviationweather.gov/data/api/) (public, no key)
- Regulations and references: 14 CFR, the AIM, and FAA handbooks (PHAK, AFH, Aviation Weather Handbook, Risk Management Handbook), all public domain
- Planned: FAA VFR raster charts and NASR data for New England, and ADS-B traffic from adsb.lol (ODbL)

Airport details in `src/data/airports.ts` are marked for checking against the current Chart Supplement until NASR import lands.

## Smoke test

`e2e/smoke.mjs` drives the built app in Chromium through onboarding, Today (brief, decide, debrief), Airplane, Review, Readiness and Settings, at iPad and phone widths, once with stubbed live weather and once offline. It checks for horizontal scroll and console errors on every screen.

```sh
npm run build && npx vite preview --port 4173 &
npm run smoke
```

It needs Playwright with Chromium available (`npm i -D playwright && npx playwright install chromium` if you don't have it).
