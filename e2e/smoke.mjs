// End-to-end smoke test. Run against a preview build:
//   npm run build && npx vite preview --port 4173 &
//   node e2e/smoke.mjs [http://localhost:4173]
// Weather and airport requests are stubbed, so it runs offline and exercises
// both the live path and the practice-weather fallback. Ask the instructor is
// stubbed too: on in the live runs, with no API key in the offline ones. Covers onboarding,
// the course home, lessons 1.1 and 2.1 to 9.1 end to
// end, 2.2 through its dials, the daily flight through filing, Trip and its
// planning lesson, every rail screen, and a radio practice flight, at desktop
// and phone widths.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Plain require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const METAR = 'METAR KPSM 241656Z 32008KT 10SM FEW045 16/02 A3008 RMK AO2';
const TAF = 'TAF KPSM 241720Z 2418/2518 32010KT P6SM FEW050 FM250000 VRB03KT P6SM SKC';
const AIRPORT = [{ icaoId: 'KPSM', name: 'PORTSMOUTH INTL AT PEASE', state: 'NH', elev: 30, magdec: '15W', lat: 43.08, lon: -70.82, tower: 'T', runways: [{ id: '16/34', dimension: '11321x150', surface: 'A', alignment: '160' }] }];
// Made-up fields around the home field for Trip: two that pass, one under the ceiling minimum, one with a short grass strip.
const TRIP_FIELDS = [
  { icaoId: 'KQAA', name: 'TESTVILLE/TESTVILLE MUNI', lat: 43.55, lon: -71.45, elev: 150, magdec: '15W', tower: null, runways: [{ id: '05/23', dimension: '4000x75', surface: 'A', alignment: 50 }], sky: 'FEW050' },
  { icaoId: 'KQBB', name: 'SAMPLETON/SAMPLETON RGNL', lat: 42.6, lon: -71.6, elev: 90, magdec: '15W', tower: 'T', runways: [{ id: '14/32', dimension: '5000x100', surface: 'A', alignment: 140 }], sky: 'SCT060' },
  { icaoId: 'KQCC', name: 'EXAMPLE/EXAMPLE FLD', lat: 43.0, lon: -71.9, elev: 200, magdec: '15W', tower: null, runways: [{ id: '18/36', dimension: '4500x75', surface: 'A', alignment: 180 }], sky: 'BKN015' },
  { icaoId: 'KQDD', name: 'PLACEHOLDER/PLACEHOLDER STRIP', lat: 43.45, lon: -70.95, elev: 120, magdec: '15W', tower: null, runways: [{ id: '09/27', dimension: '1900x80', surface: 'T', alignment: 90 }], sky: 'CLR' },
];
const p2 = (n) => String(n).padStart(2, '0');
/** A winds aloft bulletin valid three hours from now, so it covers the default departure. */
function windsAloft() {
  const v = new Date(Date.now() + 3 * 3_600_000);
  return [`VALID ${p2(v.getUTCDate())}${p2(v.getUTCHours())}00Z   FOR USE 0000-2400Z. TEMPS NEG ABV 24000`, '', 'FT  3000    6000    9000', 'PSM 2715 2722+05 2830-01'].join('\n');
}

const HANDBOOK = readFileSync(new URL('./fixtures/handbook.pdf', import.meta.url));

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

async function open(viewport, live) {
  const browser = await chromium.launch();
  // Block the service worker so page.route sees every API request.
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Every handbook request gets the same small test PDF.
  await page.route('**/api/docs/**', (r) => r.fulfill({ contentType: 'application/pdf', body: HANDBOOK }));
  await page.route('**/api/awc/**', (r) => {
    if (!live) return r.fulfill({ status: 500, body: 'down' });
    const u = new URL(r.request().url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    const area = u.searchParams.has('bbox');
    if (u.pathname.endsWith('/metar') && area) {
      return json([{ icaoId: 'KPSM', rawOb: METAR }, ...TRIP_FIELDS.map((f) => ({ icaoId: f.icaoId, rawOb: `METAR ${f.icaoId} 241656Z 30008KT 10SM ${f.sky} 15/03 A3008 RMK AO2` }))]);
    }
    if (u.pathname.endsWith('/taf') && area) return json([{ icaoId: 'KPSM', rawTAF: TAF }]);
    if (u.pathname.endsWith('/stationinfo')) return json([{ icaoId: 'KPSM', lat: 43.08, lon: -70.82 }, ...TRIP_FIELDS.map((f) => ({ icaoId: f.icaoId, lat: f.lat, lon: f.lon }))]);
    if (u.pathname.endsWith('/windtemp')) return r.fulfill({ body: windsAloft() });
    if (u.pathname.endsWith('/metar')) return r.fulfill({ body: METAR });
    if (u.pathname.endsWith('/taf')) return r.fulfill({ body: TAF });
    if (u.pathname.endsWith('/airport')) {
      const ids = (u.searchParams.get('ids') ?? '').split(',');
      return json([...AIRPORT, ...TRIP_FIELDS].filter((a) => ids.includes(a.icaoId)));
    }
    return r.fulfill({ status: 404, body: '' });
  });
  // Ask the instructor: the worker has a key in live runs and none offline.
  const asks = [];
  await page.route('**/api/ask', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: live }) });
    if (!live) return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    asks.push(JSON.parse(r.request().postData() ?? '{}'));
    await new Promise((done) => setTimeout(done, 150));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: 'Count back to the **third most recent** takeoff and landing.', refs: ['14 CFR 61.57(a)', 'Not a real source'] }) });
  });
  return { browser, page, errors, asks };
}

async function run(viewport, live) {
  const label = `[${viewport.width}px ${live ? 'live' : 'offline'}]`;
  const { browser, page, errors, asks } = await open(viewport, live);
  const noHScroll = async (where) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= viewport.width, `${label} no horizontal scroll on ${where} (${w}px)`);
  };
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const rail = (name) => page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name, exact: true });
  const main = () => page.locator('main').innerText();

  // Onboarding
  await page.goto(BASE);
  await btn('Set up').click();
  const ident = live ? 'PSM' : 'ASH';
  await page.getByLabel(/identifier/i).first().fill(ident);
  await btn('Look up').click();
  const icao = live ? 'KPSM' : 'KASH';
  await page.waitForTimeout(300);
  const name = await page.getByLabel('Name', { exact: true }).first().inputValue();
  check(live ? /PORTSMOUTH/i.test(name) : /Boire Field/.test(name), `${label} airport lookup filled ${icao} (${name})`);
  check(live ? await page.getByText(/METAR KPSM/).first().isVisible() : await page.getByText(/sample/i).first().isVisible(),
    `${label} weather preview shows ${live ? 'live METAR' : 'sample label'}`);
  await noHScroll('airport step');
  await btn('Save airport').click();
  const template = page.getByRole('button', { name: /Cessna 172 \(150 hp/ });
  check(await template.isVisible(), `${label} reached aircraft step with a template to pick`);
  check(await btn('Save airplane').isDisabled().catch(() => true), `${label} nothing preselected on the aircraft step`);
  await template.click();
  await btn('Use sample numbers for now').click();
  await btn('Save').click();
  await btn('Start the course').click();

  // Course home
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(true, `${label} landed on the course home`);
  let body = await main();
  check(/Next lesson/.test(body) && /1\.1 Are you current to carry passengers/.test(body), `${label} course home introduces lesson 1.1`);
  check(await btn('Start lesson 1.1').isVisible(), `${label} Start lesson button visible`);
  check(/Today's real conditions at/.test(body), `${label} daily flight listed`);
  check((await page.locator('.module.planned').count()) === 0 && !/being written|Coming/.test(body), `${label} every module is written, nothing says coming`);
  check(await page.getByRole('list', { name: 'Modules' }).locator('li').count() === 9, `${label} strip shows nine modules`);
  check(!/C172K|N\d{3,5}[A-Z]{0,2}\b/.test(body), `${label} no tail number or type assumed in course copy`);
  await noHScroll('course home');

  // Lesson 1.1, end to end
  await btn('Start lesson 1.1').click();
  await page.getByRole('heading', { name: 'A friend wants to come along' }).waitFor();
  check((await page.locator('.records.logbook').count()) === 1 && /made-up logbook page/.test(await main()), `${label} 1.1 shows the logbook page, labeled made up`);
  await noHScroll('lesson 1.1 brief');
  check(/Situation 1 of \d/.test(await main()), `${label} first flight of 1.1 is its first situation`);
  const askRegion = page.getByRole('region', { name: 'Ask the instructor' });
  if (live) {
    await btn('Ask the instructor').click();
    await page.getByLabel('Your question').fill('Which landings count for this?');
    await askRegion.getByRole('button', { name: 'Ask', exact: true }).click();
    await askRegion.getByText(/third most recent/).waitFor();
    const askText = await askRegion.innerText();
    check(/61\.57/.test(askText) && !/Not a real source/.test(askText), `${label} 1.1 instructor answers with only refs that resolve`);
    check(asks.length === 1 && asks[0].context?.lesson?.id === '1.1' && asks[0].question === 'Which landings count for this?', `${label} ask sends the lesson and the typed question`);
    await noHScroll('lesson 1.1 ask');
  } else {
    await page.waitForTimeout(200);
    check(await btn('Ask the instructor').count() === 0 && await askRegion.count() === 0, `${label} Ask the instructor hidden without a key`);
  }
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Day currency, worked' }).waitFor();
  check(/Third most recent/.test(await main()), `${label} 1.1 worked example counts back to the third landing`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/Landings that count at night/).fill('2');
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: '7:12 PM', exact: true }).click();
  await btn('Check my numbers').click();
  body = await main();
  check((body.match(/Right\./g) ?? []).length === 3 && /40 minutes after sunset/.test(body), `${label} 1.1 turn checks all three answers right`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: /^The plan for / }).waitFor();
  if (live) {
    await btn('Ask the instructor').click();
    await page.getByLabel('Your question').fill('What should I weigh here?');
    await page.getByLabel('Your question').press('Enter');
    await page.getByRole('region', { name: 'Ask the instructor' }).getByText(/third most recent/).waitFor();
    const before = JSON.stringify(asks.at(-1)?.context ?? {});
    check(asks.length === 2 && asks[1].context?.step?.kind === 'decide' && !/"grade"|"bestCalls"|"consequence"/.test(before), `${label} ask before commit sends no grades or best call`);
  }
  await page.getByRole('button', { name: /Leave 45 minutes earlier/ }).click();
  await btn('Commit').click();
  check(/Best call/.test(await main()) && /day currency covers it/i.test(await main()), `${label} 1.1 decision graded with its consequence`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/3 of 3/.test(body) && /PA\.I\.A/.test(body) && /61\.57/.test(body), `${label} 1.1 debrief counts blanks and cites 61.57`);
  const stored11 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored11['1.1']?.lastGrade === 'best', `${label} lesson 1.1 recorded in course progress`);
  await noHScroll('lesson 1.1 debrief');
  await btn('Back to course').first().click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();

  // Lesson 2.1, end to end, from the module list
  await page.locator('summary').filter({ hasText: 'Weather' }).first().click();
  await page.getByRole('button', { name: /Reading the METAR before you drive out.*start$/ }).click();
  await page.getByRole('heading', { name: /Before you leave the house/ }).waitFor();
  check(/Practice weather/.test(await main()), `${label} lesson weather labeled practice`);
  check((await page.locator('.metar').count()) > 0, `${label} brief shows the METAR figure`);
  check(await page.getByRole('list', { name: 'Steps of this lesson' }).locator('li.now').innerText().then((t) => /Brief/.test(t)), `${label} strip marks Brief as now`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Group by group' }).waitFor();
  check(/Zulu/.test(await main()), `${label} worked example rendered with instructor copy`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  check(await btn('Check my numbers').isDisabled(), `${label} Check disabled until every blank is filled`);
  await page.getByLabel(/Ceiling/).fill('5000');
  await page.getByLabel(/Visibility/).fill('9');
  await page.getByRole('button', { name: 'VFR', exact: true }).click();
  check((await page.getByText(/Right\./).count()) === 0, `${label} no answers revealed before Check`);
  await btn('Check my numbers').click();
  body = await main();
  check(/Right\./.test(body) && /Not quite\. 10 SM/.test(body), `${label} per-blank right/wrong with the answer after Check`);
  check(/lowest broken or overcast/.test(body), `${label} explain text shown after Check`);
  await noHScroll('lesson turn step');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Do you drive out?' }).waitFor();
  check(await btn('Commit').isDisabled(), `${label} Commit disabled before a choice`);
  check((await page.getByText(/^(Best call|Unsafe|Marginal|Sound)$/).count()) === 0, `${label} grades hidden before commit`);
  check((await page.locator('.metar').count()) > 0, `${label} the report stays open beside the decision`);
  await page.getByRole('button', { name: /Drive out and start the preflight/ }).click();
  check((await page.locator('input[type=range]').count()) === 0, `${label} no confidence slider`);
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /A good day/.test(body), `${label} grades and consequence shown after commit`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/Manage\/Decide/.test(body), `${label} debrief shows the LCG level`);
  check(/2 of 3/.test(body), `${label} debrief counts blanks right`);
  check(/PA\.I\.C/.test(body) && /Aviation Weather Handbook, METAR/.test(body), `${label} debrief shows ACS code and reference`);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored['2.1']?.attempts === 1 && stored['2.1']?.lastGrade === 'best' && stored['1.1'], `${label} lesson 2.1 recorded in course progress`);
  await noHScroll('lesson debrief');

  // References: regulations and the AIM link out; a handbook opens in the viewer at the passage.
  const aimHref = await page.getByRole('link', { name: /AIM 7-1/ }).first().getAttribute('href');
  check(/aim_html\/chap7_section_1\.html$/.test(aimHref ?? ''), `${label} AIM reference links to its section`);
  await page.getByRole('button', { name: 'Aviation Weather Handbook, METAR' }).click();
  const viewer = page.getByRole('dialog', { name: 'Aviation Weather Handbook' });
  await viewer.waitFor();
  await viewer.locator('.textLayer .hit').first().waitFor({ timeout: 15000 });
  check(/Page 3 of 3/.test(await viewer.innerText()), `${label} viewer skips the contents page and opens at the passage`);
  check((await viewer.locator('canvas').count()) === 1, `${label} viewer renders the page`);
  check(/FAA-H-8083-28B/.test(await viewer.innerText()), `${label} viewer names the edition`);
  await noHScroll('handbook viewer');
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  check(await page.getByRole('button', { name: 'Aviation Weather Handbook, METAR' }).evaluate((el) => el === document.activeElement), `${label} closing the viewer returns focus to the reference`);

  // The debrief points back to module 1; start 2.2 from the module list.
  check(await page.getByRole('button', { name: /^Next lesson: 1\.2/ }).isVisible(), `${label} 2.1 debrief offers the next lesson in course order, 1.2`);
  await btn('Back to course').first().click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  await page.locator('summary').filter({ hasText: 'Weather' }).first().click();
  await page.getByRole('button', { name: /Wind on the runway.*start$/ }).click();
  await page.getByRole('heading', { name: 'Two norths' }).waitFor();
  check(/variation/i.test(await main()), `${label} lesson 2.2 starts with the two-norths brief`);
  await btn('Continue').click();
  check((await page.locator('svg[aria-label*="Runway"]').count()) > 0, `${label} 2.2 worked example shows the wind diagram`);

  // Dials: through the turn, then turn the wind and watch the engine follow.
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  for (const input of await page.locator('.blanks input').all()) await input.fill('1');
  await btn('Check my numbers').click();
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Turn the wind' }).waitFor();
  check((await page.locator('input[type=range]').count()) === 3, `${label} 2.2 dials step shows wind direction, speed and gust dials`);
  check(await btn('Continue').isDisabled(), `${label} dials step waits for the find-it check`);
  check(/How the engine grades it right now/.test(await main()) && (await page.locator('.verdict .gradechip').count()) === 4, `${label} dials show live grades for the four choices`);
  check((await page.locator('aside svg[aria-label*="Runway"]').count()) > 0 && /as you have turned it|written for this lesson/.test(await main()), `${label} dials step shows the live wind figure and report`);
  const runwayBefore = await page.locator('.readouts > div').filter({ hasText: 'Best runway' }).locator('dd').innerText();
  const dir = page.getByLabel(/Wind from, true/);
  const dirStart = Number(await dir.inputValue());
  await dir.focus();
  for (let i = 0; i < 18; i++) await page.keyboard.press(dirStart > 180 ? 'ArrowLeft' : 'ArrowRight');
  const runwayAfter = await page.locator('.readouts > div').filter({ hasText: 'Best runway' }).locator('dd').innerText();
  body = await main();
  check(runwayAfter !== runwayBefore && /favors runway/.test(body), `${label} turning the wind 180 degrees flips the runway and says so (${runwayBefore} to ${runwayAfter})`);
  check(/as you have turned it/.test(body), `${label} turned report is labeled as turned`);
  await btn("Back to the lesson's numbers").click();
  check(Number(await dir.inputValue()) === dirStart, `${label} reset puts the dials back on the lesson's numbers`);
  const gust = page.getByLabel(/Gusts to/);
  await gust.focus();
  await page.keyboard.press('Home');
  check(/no gust/.test(await main()), `${label} gust dial at zero reads no gust`);
  await btn('Check this setting').click();
  body = await main();
  check(/Right\.|Not quite\./.test(body) && /across/.test(body), `${label} the engine checks the dial setting and explains it`);
  check(await btn('Continue').isEnabled(), `${label} dials step can continue after the check`);
  await noHScroll('lesson 2.2 dials');
  await btn('Continue').click();
  await page.getByRole('heading', { name: /Holding short of/ }).waitFor();
  await btn('Leave lesson').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  body = await main();
  check(/1\.2 The documents in the airplane/.test(body) && /\b2 of \d+/.test(body), `${label} course home advances to 1.2 with 2 lessons flown`);

  // Persistence: reload should skip onboarding and keep progress.
  await page.reload();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(/\b2 of \d+/.test(await main()), `${label} progress survives reload, onboarding not shown again`);

  // Lesson 8.1, end to end: minimums widened for the day, and a passenger waiting.
  await page.locator('.module').filter({ hasText: 'Human factors and risk' }).locator('summary').click();
  await page.getByRole('button', { name: /8\.1 Minimums under pressure/ }).click();
  await page.getByRole('heading', { name: 'A number written on a calm day' }).waitFor();
  body = await main();
  check(/Module 8, Human factors and risk/.test(body) && /PA\.I\.H/.test(body), `${label} 8.1 header names the module and ACS task`);
  check(/add at least 500 feet/.test(body) && (await page.locator('.metar').count()) > 0, `${label} 8.1 brief gives the RMH margin beside the report`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your numbers, widened' }).waitFor();
  check(/3,000 → 3,500 ft/.test(await main()), `${label} 8.1 worked example widens the pilot's own ceiling`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/Ceiling you need today/).fill('3500');
  await page.getByLabel(/Visibility you need today/).fill('5.5');
  await page.getByLabel(/Ceiling short by/).fill('300');
  await page.getByRole('button', { name: 'External pressures', exact: true }).click();
  await page.getByRole('button', { name: 'Macho', exact: true }).click();
  await btn('Check my numbers').click();
  body = await main();
  check((body.match(/Right\./g) ?? []).length === 4 && /Not quite\. 200 ft/.test(body), `${label} 8.1 blanks checked, the short-by answer corrected`);
  await noHScroll('lesson 8.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your friend is already at the airport' }).waitFor();
  check(/clears the 3,000 foot minimum you wrote down, but not the 3,500/.test(await main()), `${label} 8.1 decision states both minimums`);
  await page.getByRole('button', { name: /Call it for today/ }).click();
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /Unsafe/.test(body) && /Saying no to someone you like/.test(body), `${label} 8.1 grades and consequence shown after commit`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/4 of 5/.test(body) && /Risk Management Handbook, personal minimums/.test(body), `${label} 8.1 debrief counts blanks and cites the RMH`);
  check(await page.getByRole('button', { name: 'PHAK, the PAVE checklist' }).isVisible(), `${label} 8.1 PAVE reference opens in the viewer`);
  const stored8 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored8['8.1']?.lastGrade === 'best', `${label} lesson 8.1 recorded in course progress`);
  await noHScroll('lesson 8.1 debrief');
  await page.getByRole('button', { name: 'Back to course' }).first().click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(/\b3 of \d+/.test(await main()), `${label} course home counts 8.1 as flown`);

  // Lesson 7.1, end to end: the alternator light, battery minutes and the field it reaches.
  await page.locator('.module summary').filter({ hasText: 'Systems and the panel' }).click();
  await page.getByRole('button', { name: /7\.1 Electrical system and the alternator light/ }).click();
  await page.getByRole('heading', { name: 'Where the electrons come from' }).waitFor();
  body = await main();
  check(/magnetos/.test(body) && /practice sectional|Heading home to KXYZ/.test(body), `${label} 7.1 brief flies on the practice chart`);
  check(await page.locator('.fig figcaption').filter({ hasText: /[Ss]ample/ }).first().isVisible(), `${label} 7.1 electrical figure says its loads are sample values`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The light comes on' }).waitFor();
  check(/12 Ah ÷ 21\.2 A × 60/.test(await main()), `${label} 7.1 worked example shows the battery arithmetic`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/Load after shedding/).fill('4.2');
  await page.getByLabel(/Battery minutes/).fill('170');
  await page.getByLabel(/Minutes to home/).fill('29');
  await btn('Check my numbers').click();
  check((await page.getByText(/Right\./).count()) === 3, `${label} 7.1 all three numbers checked right`);
  await noHScroll('lesson 7.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Which field?' }).waitFor();
  check((await page.locator('.sectional svg').count()) === 1, `${label} 7.1 decision shows the practice chart`);
  await page.getByRole('button', { name: /Shed load, call KXYZ tower early/ }).click();
  await btn('Commit').click();
  check(/Best call/.test(await main()), `${label} 7.1 shedding and going home grades best`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/PA\.I\.G/.test(body) && /PHAK, electrical system/.test(body), `${label} 7.1 debrief shows ACS code and reference`);
  const stored71 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored71['7.1']?.lastGrade === 'best', `${label} lesson 7.1 recorded in course progress`);
  await noHScroll('lesson 7.1 debrief');
  await btn('Back to course').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();

  // Lesson 5.1, end to end: the nav log on the practice sectional.
  await page.locator('summary').filter({ hasText: 'Cross-country and diversion' }).click();
  await page.getByRole('button', { name: /5\.1 Building a nav log/ }).click();
  await page.getByRole('heading', { name: 'A trip to Quill Valley' }).waitFor();
  body = await main();
  check(/practice sectional/i.test(body) && /Not a real chart/.test(body), `${label} 5.1 flies on the practice sectional, labeled practice`);
  check(/sample values/.test(body), `${label} 5.1 labels the sample airplane numbers`);
  check((await page.locator('.sectional svg').count()) === 1, `${label} 5.1 brief shows the chart with the route`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: /Leg 1: KXYZ to Harlow/ }).waitFor();
  check((await page.locator('.navlog tbody tr').count()) === 1, `${label} 5.1 worked example shows the first leg of the nav log`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  const prompt = await page.locator('.situ').first().innerText();
  const [, tc, nm, tas] = prompt.match(/measures (\d{3})° and the distance ([\d.]+) nm.*?at (\d+) knots/) ?? [];
  await page.getByLabel(/Magnetic course/).fill(String((Number(tc) + 14) % 360));
  await page.getByLabel(/Time/).fill(String(Math.round((Number(nm) / Number(tas)) * 60)));
  await page.getByRole('button', { name: 'Even thousands plus 500', exact: true }).click();
  await btn('Check my numbers').click();
  check((await page.getByText(/^Right\./).count()) === 3, `${label} 5.1 magnetic course, time and hemisphere checked right`);
  await noHScroll('lesson 5.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Fuel for the trip home' }).waitFor();
  check((await page.locator('.navlog tfoot').count()) === 1, `${label} 5.1 decision shows the whole nav log`);
  await page.getByRole('button', { name: /buy fuel at Quill Valley/ }).click();
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /fuel stop is part of the plan/.test(body), `${label} 5.1 fuel stop graded best with its consequence`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/PA\.I\.D/.test(body) && /PHAK, flight planning/.test(body) && /3 of 3/.test(body), `${label} 5.1 debrief shows ACS code, reference and 3 of 3`);
  const stored5 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored5['5.1']?.lastGrade === 'best', `${label} lesson 5.1 recorded in course progress`);
  await noHScroll('lesson 5.1 debrief');
  await rail('Course').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();

  // Lesson 6.1, end to end: the turn back worked from the airplane, then the decision on the climb out.
  const lesson61 = page.getByRole('button', { name: /6\.1 Engine failure after takeoff/ });
  if (!(await lesson61.isVisible())) await page.locator('summary').filter({ hasText: 'Emergencies' }).click();
  await lesson61.click();
  await page.getByRole('heading', { name: 'The climb out' }).waitFor();
  check(/lower the nose/.test(await main()) && /made up for this lesson/.test(await main()), `${label} 6.1 brief says nose down first and labels the ground made up`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'What the turn costs' }).waitFor();
  body = await main();
  check(/225° at 45° bank/.test(body) && /sample/i.test(body), `${label} 6.1 works the turn back from labeled sample performance`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/Load factor/).fill('1.41');
  await page.getByLabel(/Stall speed rise/).fill('19');
  await page.getByLabel(/Height left/).fill('400');
  await btn('Check my numbers').click();
  body = await main();
  check(/Right\./.test(body) && /Not quite/.test(body) && /square root of the load factor/.test(body), `${label} 6.1 checks the turn-back numbers`);
  await noHScroll('lesson 6.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: /feet, and quiet/ }).waitFor();
  check((await page.locator('svg[aria-label^="Glide range"]').count()) > 0, `${label} 6.1 decision shows the glide figure`);
  check((await page.getByText(/^(Best call|Unsafe|Marginal|Sound)$/).count()) === 0, `${label} 6.1 grades hidden before commit`);
  await page.getByRole('button', { name: /Nose down, and land in the field ahead/ }).click();
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /You walk away/.test(body), `${label} 6.1 grades land-ahead best with its consequence`);
  await noHScroll('lesson 6.1 decision');
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/PA\.IX\.B/.test(body) && /AFH, engine failure after takeoff/.test(body), `${label} 6.1 debrief shows ACS code and AFH reference`);
  check(/more than you have/.test(body), `${label} 6.1 debrief explains why the turn back fails`);
  const stored6 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored6['6.1']?.attempts === 1 && stored6['6.1']?.lastGrade === 'best', `${label} lesson 6.1 recorded in course progress`);
  await btn('Back to course').last().click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(/\b\d+ of \d+ lessons flown/.test(await main()), `${label} course home back after 6.1`);
  // Lesson 9.1, the mock oral, end to end
  const lesson91 = page.getByRole('button', { name: /9\.1 Mock oral: a weekend trip/ });
  if (!(await lesson91.isVisible())) await page.locator('.module summary').filter({ hasText: 'The oral and the flight review' }).click();
  await lesson91.click();
  await page.getByRole('heading', { name: 'The examiner sets the scene' }).waitFor();
  check(/Quill Valley/.test(await main()) && (await page.locator('.sectional svg').count()) > 0, `${label} 9.1 opens on the trip with the practice sectional`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Are you current?' }).waitFor();
  await page.getByLabel(/Takeoffs and landings in the 90 days/).fill('2');
  await btn('No').click();
  await btn('Check my numbers').click();
  check((await page.getByText(/Right\./).count()) === 2, `${label} 9.1 currency counted by code`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The first leg, worked' }).waitFor();
  check((await page.locator('table.navlog').count()) > 0, `${label} 9.1 shows the nav log`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The rest of the route' }).waitFor();
  await page.getByLabel(/Total distance/).fill('63');
  await page.getByLabel(/Time en route/).fill('39');
  await page.getByLabel(/Fuel required/).fill('12');
  await btn('Check my numbers').click();
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Altitude and airspace' }).waitFor();
  await page.locator('.blank').filter({ hasText: 'Cruising altitude' }).getByRole('button').nth(1).click();
  await btn('E').click();
  await btn('Check my numbers').click();
  check(/even thousands plus 500/.test(await main()), `${label} 9.1 explains the cruising altitude rule`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Weigh it' }).waitFor();
  await page.getByLabel(/Takeoff weight/).fill('2370');
  await page.getByLabel(/Over maximum gross/).fill('8');
  await page.getByLabel(/baggage area placard/).fill('30');
  await btn('Check my numbers').click();
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The camping gear' }).waitFor();
  await page.getByRole('button', { name: /of gear behind/ }).click();
  await btn('Commit').click();
  check(/Best call/.test(await main()), `${label} 9.1 trimming the gear to the placard grades best`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Sunday afternoon' }).waitFor();
  check((await page.locator('.metar').count()) > 0, `${label} 9.1 shows the forecast for home`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'When do you leave?' }).waitFor();
  await page.getByRole('button', { name: /Leave now, ahead of the rain/ }).click();
  await btn('Commit').click();
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/Best call/.test(body) && /PA\.I\.D/.test(body) && /14 CFR 61\.57/.test(body), `${label} 9.1 debrief shows the grade, ACS and references`);
  const stored9 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored9['9.1']?.lastGrade === 'best', `${label} lesson 9.1 recorded in course progress`);
  await noHScroll('lesson 9.1 debrief');
  await btn('Back to course').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();

  // Lesson 3.1, end to end: weight and balance with the sample airplane from onboarding.
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  await page.locator('.module summary').filter({ hasText: 'Performance and loading' }).click();
  await page.getByRole('button', { name: /3\.1 Weight and balance with real passengers/ }).click();
  await page.getByRole('heading', { name: 'Four seats, not four people' }).waitFor();
  body = await main();
  check(/Lesson 1 of 4/.test(body) && /PA\.I\.F/.test(body), `${label} 3.1 header names module 3 and the ACS task`);
  check(/sample values/.test(body), `${label} 3.1 says the airplane's numbers are sample values`);
  check((await page.locator('svg[aria-label^="CG envelope"]').count()) > 0, `${label} 3.1 brief shows the CG envelope`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Just the two of you first' }).waitFor();
  body = await main();
  check(/1,998 lb/.test(body) && /40\.04 in/.test(body), `${label} 3.1 worked example totals weight and CG`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/Total weight/).fill('2378');
  await page.locator('#t1-cg').fill('45.7');
  await page.getByLabel(/Over max gross by/).fill('78');
  await btn('Check my numbers').click();
  check((await page.getByText(/^Right\./).count()) === 3, `${label} 3.1 checks weight, CG and the overage`);
  await noHScroll('lesson 3.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Who and what goes' }).waitFor();
  check((await page.getByText(/^(Best call|Unsafe|Marginal|Sound)$/).count()) === 0, `${label} 3.1 grades hidden before commit`);
  await page.getByRole('button', { name: /Take 25 gallons instead of full tanks/ }).click();
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /right at max gross/.test(body), `${label} 3.1 less fuel graded best, with the computed weight`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/3 of 3/.test(body) && /PHAK ch\. 10/.test(body), `${label} 3.1 debrief counts blanks and cites the PHAK`);
  const stored31 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored31['3.1']?.lastGrade === 'best', `${label} lesson 3.1 recorded in course progress`);
  await noHScroll('lesson 3.1 debrief');
  await btn('Back to course').first().click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(/\b8 of \d+ lessons flown/.test(await main()), `${label} course home counts 3.1 flown`);

  // Daily flight: the sheet
  await page.getByRole('button', { name: new RegExp(`Today's real conditions at ${icao}`) }).click();
  await page.getByRole('heading', { name: new RegExp(`Today's real conditions at ${icao}`) }).waitFor();
  await page.getByText('The report').first().waitFor();
  body = await main();
  check((await page.getByText(/Practice weather/i).count()) > 0 === !live, `${label} practice-weather notice ${live ? 'absent' : 'present'}`);
  check(/Sample airplane/.test(body), `${label} sample-airplane notice present`);
  check(/Covered in Lesson 2\.1\. Your reading first/.test(body), `${label} covered line asks for the reading first`);
  check(/Not covered yet, taught in Lesson 2\.2/.test(body), `${label} uncovered line filled and marked`);
  check(!/METAR K[A-Z]{3} 24/.test(body.split('Wind on the runway')[0]), `${label} covered line hides the report until read`);
  if (live) check(/335°, variation 15°W/.test(body), `${label} true-to-magnetic conversion uses KPSM variation`);
  check(await btn('Sign and commit').isDisabled(), `${label} Sign disabled before the line is read`);
  await page.getByRole('button', { name: live ? 'VFR' : 'MVFR', exact: true }).click();
  await btn('Compare with the sheet').click();
  check(/Your reading matched/.test(await main()), `${label} reading compared and matched`);
  await noHScroll('daily sheet');
  await page.getByRole('button', { name: /Go as planned/ }).click();
  await btn('Sign and commit').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/Learner-centered grading/.test(body), `${label} daily debrief shows LCG`);
  check(live ? /Best call/.test(body) : /Unsafe|Marginal/.test(body), `${label} daily grade matches conditions`);
  if (!live) {
    check((await page.locator('.line.drove').count()) > 0, `${label} lines that drove the grade are marked`);
    check(/taught in Lesson 2\.2|Lesson 2\.4 teaches/.test(body) || /teaches this/.test(body), `${label} notes name the lesson that teaches each line`);
  }
  await btn('File this briefing').click();
  check(/Filed to your logbook/.test(await main()), `${label} briefing filed`);
  const logged = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.logbook.v1') ?? '[]'));
  check(logged.length === 1 && logged[0].station === icao && logged[0].readingsTotal === 1, `${label} logbook entry written`);
  await noHScroll('daily debrief');

  // Logbook
  await rail('Logbook').click();
  body = await main();
  check(/2\.1 Reading the METAR/.test(body) && /1 attempt/.test(body), `${label} logbook lists the lesson flown`);
  check(/, Go\b/.test(body) && !/% sure/.test(body), `${label} logbook lists the filed briefing`);
  check(/Review readiness/.test(body), `${label} readiness folded into the logbook`);
  check(await page.getByRole('heading', { name: 'Flight review summary' }).isVisible() && /Lessons flown, \d+ of \d+/.test(body), `${label} flight review summary counts the lessons flown`);
  check(/Ask your CFI/.test(body), `${label} summary says what to ask the CFI`);
  await noHScroll('logbook');

  // Trip: recommendations from the home field, then the planning lesson end to end.
  await rail('Trip').click();
  await page.getByRole('heading', { name: /^Trips from/ }).waitFor();
  await btn('Plan this trip').first().waitFor();
  body = await main();
  if (live) {
    check(/Trips from KPSM/.test(body) && /KQAA/.test(body) && /KQBB/.test(body), `${label} trip ranks the live fields that pass`);
    check(/Left out/.test(body) && /KQCC/.test(body) && /Ceiling under your minimum/.test(body) && /KQDD/.test(body) && /Runway under your minimum/.test(body), `${label} trip says what it left out and why`);
  } else {
    check(/Live weather unavailable/.test(body) && /Trips from KXYZ/.test(body), `${label} trip falls back to the practice chart when live data is down`);
  }
  check(/A training plan, not a briefing/.test(body) && /NOTAMs and TFRs/.test(body), `${label} trip says it is not a briefing`);
  check((await page.locator('svg.tripmap').count()) === 1, `${label} trip draws the plan view`);
  await noHScroll('trip');
  await btn('Plan this trip').first().click();
  await btn('Continue').waitFor();
  check(/ to K\w+, \d+ nm/.test(await main()), `${label} trip lesson opens on the chosen route`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The leg out' }).waitFor();
  check(/Magnetic heading/.test(await main()) && (await page.locator('.navlog').count()) > 0, `${label} trip lesson works the leg out in a nav log`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The leg home' }).waitFor();
  for (const input of await page.locator('.blanks input').all()) await input.fill('1');
  await btn('Check my numbers').click();
  check(/Not quite/.test(await main()), `${label} trip lesson checks the leg home against the engine`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Fuel and daylight' }).waitFor();
  for (const input of await page.locator('.blanks input').all()) await input.fill('1');
  await btn('Check my numbers').click();
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'The forecast moves' }).waitFor();
  check(/amends/.test(await main()) && (await page.locator('svg.tripmap').count()) > 0, `${label} trip diversion shows the amended forecast and the map`);
  await page.locator('button.choice', { hasText: 'Press on' }).click();
  await btn('Commit').click();
  check(/Marginal|Unsafe/.test(await page.locator('button.choice', { hasText: 'Press on' }).innerText()), `${label} pressing on under your minimum is not graded best`);
  await noHScroll('trip diversion');
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  const trips = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.trip.history.v1') ?? '[]'));
  check(trips.length === 1, `${label} planned trip kept for variety`);
  await page.getByRole('button', { name: 'Back to trips', exact: true }).first().click();
  await page.getByRole('heading', { name: /^Trips from/ }).waitFor();

  // Tools
  await rail('Tools').click();
  check(await page.locator('svg').filter({ hasText: /lb|in/ }).first().isVisible(), `${label} airplane tool shows the CG chart`);
  await page.getByRole('tab', { name: 'Weather now' }).click();
  await page.locator('.metar').first().waitFor();
  check(new RegExp(`METAR ${icao}`).test(await main()), `${label} weather tool shows the raw METAR`);
  // Lessons flown join the deck. Make 2.1's decision due now and the rest later,
  // so the session opens with it, rebuilt as a fresh situation.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('downwind.review.v1') ?? '{"cards":{},"history":[]}');
    for (const id of Object.keys(s.cards)) if (id.startsWith('L:')) s.cards[id].due = id === 'L:2.1:d1' ? '2000-01-01T00:00:00.000Z' : '2999-01-01T00:00:00.000Z';
    localStorage.setItem('downwind.review.v1', JSON.stringify(s));
  });
  await page.getByRole('tab', { name: 'Review deck' }).click();
  await page.getByText(/From lesson 2\.1/).waitFor();
  check(await page.getByRole('heading', { name: 'Do you drive out?' }).isVisible(), `${label} review deck opens with a lesson decision that is due`);
  await page.getByRole('group', { name: 'Options' }).getByRole('button').first().click();
  await btn('Commit').click();
  check(/PA\.I\.C/.test(await main()), `${label} lesson card graded and shows its ACS task`);
  await noHScroll('review lesson card');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/review-lesson-card-${viewport.width}.png`, fullPage: true });
  await btn('Next').click();
  await page.getByRole('group', { name: 'Options' }).getByRole('button').first().click();
  await btn('Reveal').click();
  check(await page.getByText(/14 CFR|PHAK|AIM/).first().isVisible(), `${label} review deck shows a reference after reveal`);

  // Chart tool: the practice sectional, a route from the keyboard list, and an airspace lookup.
  await page.getByRole('tab', { name: 'Chart' }).click();
  const chartSvg = page.locator('.sectional svg');
  await chartSvg.waitFor();
  check((await chartSvg.count()) === 1 && /Practice sectional\. Not a real chart\./.test(await chartSvg.evaluate((el) => el.textContent)), `${label} chart tool renders the sectional and labels it practice`);
  check(/KXYZ/.test(await chartSvg.evaluate((el) => el.textContent)) && /\[31\]/.test(await chartSvg.evaluate((el) => el.textContent)), `${label} chart shows KXYZ and its Class D ceiling`);
  await page.getByRole('button', { name: 'Plan a route', exact: true }).click();
  const waypoint = page.getByLabel('Waypoint to add');
  await waypoint.selectOption('KXYZ');
  await btn('Add').click();
  await waypoint.selectOption('KXQC');
  await btn('Add').click();
  const navRow = page.locator('.navlog tbody tr').first();
  check(/KXYZ to KXQC/.test(await navRow.innerText()) && /\b\d{3}\b/.test(await navRow.innerText()), `${label} nav log shows the KXYZ to KXQC leg with headings`);
  check(/Legal VFR cruising altitudes/.test(await main()), `${label} route panel lists legal cruising altitudes`);
  // A long leg carries "TC 340  25 nm"; at phone width the same leg is too short for the course and shows "25 nm".
  check(/TC 340|25 nm/.test(await chartSvg.evaluate((el) => el.textContent)), `${label} chart draws the leg with its course or distance`);
  await page.getByRole('button', { name: 'Look up a point', exact: true }).click();
  await page.getByLabel('Your altitude, ft MSL').fill('2500');
  await page.getByLabel('Choose a place on the chart').selectOption('KXYZ');
  const lookup = await page.locator('.lookup').innerText();
  check(/Class D/.test(lookup) && /Over Practice field at 2,500 ft/.test(lookup), `${label} lookup over KXYZ at 2,500 ft says Class D`);
  check(/Two-way radio communication established with the tower/.test(lookup) && /3 SM/.test(lookup), `${label} lookup lists the Class D requirement and 3 SM`);
  await noHScroll('tools');

  // Lesson 4.1, end to end: the practice sectional, a data block, and a cruising altitude.
  await rail('Course').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  await page.locator('.module summary', { hasText: 'Airspace and the chart' }).click();
  await page.getByRole('button', { name: /4\.1 Reading the chart around your field/ }).click();
  await page.getByRole('heading', { name: 'A chart is a list of facts' }).waitFor();
  check(/practice sectional/i.test(await main()) && (await page.locator('.sectional svg').count()) === 1, `${label} 4.1 brief shows the practice sectional`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'KXYZ, taken apart' }).waitFor();
  body = await main();
  check(/3,100 ft MSL/.test(body) && /2,500 ft above the field/.test(body), `${label} 4.1 example decodes the Class D ceiling from the engine`);
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'Your turn', exact: true }).waitFor();
  await page.getByLabel(/^Field elevation/).fill('820');
  await page.getByRole('button', { name: '122.90', exact: true }).click();
  await page.getByLabel(/^Pattern height/).fill('1000');
  await page.getByLabel(/^Maximum elevation figure/).fill('2000');
  await page.getByRole('button', { name: 'Class E', exact: true }).click();
  await btn('Check my numbers').click();
  body = await main();
  check((body.match(/Right\./g) ?? []).length === 5 && !/Not quite/.test(body), `${label} 4.1 turn: all five readings right`);
  await noHScroll('lesson 4.1 turn');
  await btn('Continue').click();
  await page.getByRole('heading', { name: 'How high to Long Lake?' }).waitFor();
  await page.locator('button.choice', { hasText: '4,500 ft' }).click();
  await btn('Commit').click();
  body = await main();
  check(/Best call/.test(body) && /legal cruising altitude/.test(body), `${label} 4.1 decision graded best with the engine's reason`);
  await btn('Debrief').click();
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/5 of 5/.test(body) && /PA\.I\.E/.test(body) && /14 CFR 91\.159/.test(body), `${label} 4.1 debrief counts blanks and cites the ACS and 91.159`);
  const stored41 = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.course.v1') ?? '{}'));
  check(stored41['4.1']?.lastGrade === 'best', `${label} lesson 4.1 recorded in course progress`);
  await noHScroll('lesson 4.1 debrief');
  await page.getByRole('button', { name: 'Back to course', exact: true }).first().click();

  // Pilot
  await rail('Pilot').click();
  check(await btn('Run setup again').isVisible(), `${label} pilot screen offers Run setup again`);
  check(await btn('Reset course progress').isVisible(), `${label} pilot screen offers a course reset`);
  check(await page.getByText(/not for navigation/i).first().isVisible(), `${label} disclaimer visible`);
  await noHScroll('pilot');

  check(errors.length === 0, `${label} no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

// A fresh install that skips setup must still have a course to start, from the practice field.
async function runSkip() {
  const label = '[skip setup]';
  const { browser, page, errors } = await open({ width: 1180, height: 820 }, false);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  let body = await page.locator('main').innerText();
  check(/practice field/i.test(body), `${label} course home says lessons fly from a practice field`);
  check(!/KASH|Nashua|C172|KPSM/.test(body), `${label} no bundled airport or airplane assumed`);
  check(/Needs a home airport/.test(body), `${label} daily flight asks for a home airport`);
  await page.getByRole('button', { name: 'Start lesson 1.1', exact: true }).click();
  await page.getByRole('heading', { name: 'A friend wants to come along' }).waitFor();
  body = await page.locator('main').innerText();
  check(/Practice field, not a real airport/.test(body), `${label} lesson header says practice field`);
  check(!/KASH|C172|Cessna/.test(body), `${label} lesson assumes no airport or airplane`);
  await page.getByRole('button', { name: 'Leave lesson', exact: true }).click();
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Tools', exact: true }).click();
  check(await page.getByText(/No airplane yet/).first().isVisible(), `${label} airplane tool shows the not-set-up state`);
  await page.getByRole('tab', { name: 'Weather now' }).click();
  check(await page.getByRole('button', { name: 'Set home airport', exact: true }).isVisible(), `${label} weather tool offers to set the home airport`);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Pilot', exact: true }).click();
  check(await page.getByText(/No home airport yet/).first().isVisible(), `${label} pilot screen shows no home airport`);
  check(errors.length === 0, `${label} no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

// Radio practice, a whole flight: the ATIS copy pad, initial calls that leave
// things out (so the controller's correction shows), readbacks that echo the
// controller, the decisions, and the debrief. Flights are random, so the loop
// reads each step from the page.
async function runRadio(viewport) {
  const label = `[radio ${viewport.width}px]`;
  const { browser, page, errors } = await open(viewport, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const main = () => page.locator('main').innerText();
  const noHScroll = async (where) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= viewport.width, `${label} no horizontal scroll on ${where} (${w}px)`);
  };
  await page.goto(BASE);
  await btn('Skip setup for now').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  await page.getByRole('button', { name: /Radio practice at the practice field/ }).click();
  await page.getByRole('heading', { name: 'Radio practice', exact: true }).waitFor();
  let body = await main();
  check(/not a real airport/i.test(body) && /52XY/.test(body), `${label} radio home says practice field and practice tail`);
  check(!/KASH|Nashua|KPSM/.test(body), `${label} radio home assumes no real airport`);
  check((await page.getByRole('button', { name: /microphone|speak|record/i }).count()) === 0, `${label} no microphone control`);
  await noHScroll('radio home');
  await page.getByRole('button', { name: /Pattern work/ }).first().click();

  let fixes = 0;
  let echoes = 0;
  let echoClean = 0;
  let steps = 0;
  let noLeak = true;
  for (; steps < 40; steps++) {
    if (await page.getByRole('heading', { name: 'Debrief', exact: true }).isVisible()) break;
    const call = page.getByLabel('Your call');
    if (await btn('Check my copy').isVisible()) {
      await page.getByLabel('Information', { exact: true }).fill('Delta');
      await page.getByLabel('Wind', { exact: true }).fill('240 at 8');
      await page.getByLabel('Altimeter', { exact: true }).fill('29.92');
      await btn('24').click();
      await btn('Check my copy').click();
      if (steps === 0) await noHScroll('ATIS');
    } else if (await call.isVisible()) {
      noLeak &&= !(await page.locator('.gradechip').count());
      const atc = page.locator('.tape > .xmit.atc .say').first();
      if (await atc.count()) {
        const said = (await atc.innerText()).replace(/^November 2XY,\s*/, '').replace(/\.$/, '');
        await call.fill(`${said}, November 2XY`);
        await btn('Transmit').click();
        echoes++;
        if (!(await call.isVisible())) echoClean++;
      } else {
        await call.fill('November 52XY');
        await call.press('Enter');
        if (await call.isVisible()) {
          fixes++;
          if (fixes === 1) await noHScroll('controller correction');
          await call.fill('November 52XY');
          await btn('Transmit').click();
        }
      }
      check(await page.getByText('A good call').first().isVisible(), `${label} step ${steps}: a good call shown after transmitting`);
    } else if (await btn('Commit').isVisible()) {
      await page.locator('.choices .choice').first().click();
      await btn('Commit').click();
    }
    const next = (await btn('Debrief').isVisible()) ? btn('Debrief') : btn('Continue');
    await next.click();
  }
  check(steps > 8, `${label} a pattern flight has more than eight steps (${steps})`);
  check(fixes > 0, `${label} an incomplete call gets the controller's correction (${fixes})`);
  check(echoes > 3 && echoClean === echoes, `${label} reading back the controller's words is accepted every time (${echoClean} of ${echoes})`);
  check(noLeak, `${label} no grade shown before a call is transmitted`);
  await page.getByRole('heading', { name: 'Debrief', exact: true }).waitFor();
  body = await main();
  check(/AIM 4-3-18/.test(body) && /PA\.III\.A/.test(body), `${label} debrief cites the AIM and the ACS`);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('downwind.radio.v1') ?? '[]'));
  check(log.length === 1 && log[0].mission === 'pattern', `${label} flight recorded in the radio log`);
  await noHScroll('radio debrief');
  await btn('New flight').click();
  check(await btn('Check my copy').isVisible(), `${label} a new flight starts at the ATIS`);
  check(errors.length === 0, `${label} no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

try { await runSkip(); } catch (e) { check(false, `[skip setup] crashed: ${e.message.split('\n')[0]}`); }
for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
  try { await runRadio(vp); } catch (e) { check(false, `[radio ${vp.width}px] crashed: ${e.message.split('\n')[0]}`); }
}
for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
  for (const live of [true, false]) {
    try { await run(vp, live); } catch (e) { check(false, `[${vp.width}px ${live ? 'live' : 'offline'}] crashed: ${e.message.split('\n')[0]}`); }
  }
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll smoke checks passed');
process.exit(failures.length ? 1 : 0);
