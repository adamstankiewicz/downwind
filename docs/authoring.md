# Writing a module

Downwind is a guided ground school. Each lesson is a short flight that the
instructor briefs, works through once, then hands to the pilot. Module 2,
Weather (`src/course/weather.ts`), is the reference. Read it before you write
anything.

## The shape of a lesson

A `Lesson` (see `src/course/types.ts`) has an id like `3.2`, a title written
in the pilot's words, minutes, ACS task codes, references, and
`build(ctx)`. `build` returns the steps.

1. **brief**: the scene and what this lesson is about. The instructor's
   `say` has a `full` version and a `short` one. The short one is used once
   the pilot has shown they have the idea.
2. **example**: the instructor works one case in `work` rows, showing the
   arithmetic.
3. **turn**: the pilot does the next case alone in `blanks`. Numbers are
   checked within a `tolerance`, and choices come from a list. Every blank
   has an `explain`.
4. **decide**: a real decision with three or four options. `grades` and
   `consequence` are keyed by option id. Name ids for what they mean
   (`land-ahead`, `turn-back`, `climb`, `divert`). Weather decisions use
   `go`, `go-plan`, `delay` and `cancel`.

Lessons can branch with `showIf`. For example, the in-flight step in 2.5
only shows if the pilot went.

## Rules

- **Code computes every number and every grade.** Copy never contains a
  number that the engine could compute: use the engine and interpolate.
  Grades come from a function you can unit test, never a hand-written table
  that might disagree with the copy.
- **Build around the pilot's own airplane, field and minimums**
  (`ctx.aircraft`, `ctx.airport`, `ctx.minimums`). Without them, use the
  practice field KXYZ and the practice sectional
  (`src/chart/practiceRegion.ts`). Never assume a real airport, aircraft or
  person in code or copy.
- **Sample data is labeled.** Performance charts from
  `sampleTrainerPerformance()` are sample values. Say so wherever they
  appear: set the `perf` figure's `sample: true`, and add a line in the copy.
- **Voice is never required.** Typing and tapping only.
- **Cite sources.** Use the labels the reference resolver knows
  (`src/refs/resolve.ts`): `14 CFR 91.155(c)`, `AIM 3-2-5`, `PHAK ch. 11`,
  or a handbook passage added to `PASSAGES`. The unit test fails on a label
  that doesn't resolve.
- **The instructor's voice** is plain, direct and kind. It explains why
  before what. It never lectures after a good call. Use no em dashes and no
  exclamation marks.
- **ACS codes** use the FAA-S-ACS-6C task codes (`PA.I.F` and so on).

## Engine

| Need | Use |
|---|---|
| Density and pressure altitude | `lib/density.ts` |
| Takeoff, landing, climb, fuel, glide | `lib/perf.ts` |
| Distance, course, wind triangle, nav log, cruising altitudes | `lib/nav.ts` |
| Airspace class, entry requirements, VFR minimums | `lib/airspace.ts` |
| Weight and balance | `lib/wb.ts` |
| Weather text and go/no-go grades | `lib/metar.ts`, `lib/taf.ts`, `scenarios/goNoGo.ts`, `course/practice.ts` |
| The practice chart | `chart/practiceRegion.ts` |

## Figures

Set these on a step's `figure`: `metar`, `taf`, `wind`, `chart` (the
practice sectional with a route, highlights, a focus and an airplane
marker), `perf` (a POH-style chart with the reading marked), `navlog` and
`glide`.

## Finishing a module

- Add the lessons to the module in `src/course/modules.ts` and clear its
  `outline`.
- Add tests in `src/course/__tests__/` that build every lesson across the
  three pilot contexts used for module 2 (no home field, a real-shaped
  field, tight minimums). Check that each decision grades as the lesson
  intends.
- Extend `e2e/smoke.mjs` to fly the first lesson of the module end to end.
- `npx tsc -b && npx vitest run && npm run build`, then the smoke test
  against `vite preview`. All must pass before opening a PR.
