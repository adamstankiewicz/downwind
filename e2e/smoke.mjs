// End-to-end smoke test. Run against a preview build:
//   npm run build && npx vite preview --port 4173 &
//   node e2e/smoke.mjs [http://localhost:4173]
// Weather and airport requests are stubbed, so it runs offline and exercises
// both the live path and the practice-weather fallback. Covers onboarding,
// the course home, lesson 2.1 end to end, the start of 2.2, the daily flight
// through filing, and every rail screen, at desktop and phone widths.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Plain require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const METAR = 'METAR KPSM 241656Z 32008KT 10SM FEW045 16/02 A3008 RMK AO2';
const TAF = 'TAF KPSM 241720Z 2418/2518 32010KT P6SM FEW050 FM250000 VRB03KT P6SM SKC';
const AIRPORT = [{ icaoId: 'KPSM', name: 'PORTSMOUTH INTL AT PEASE', state: 'NH', elev: 30, magdec: '15W', runways: [{ id: '16/34', alignment: '160' }] }];

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
    if (u.pathname.endsWith('/metar')) return r.fulfill({ body: METAR });
    if (u.pathname.endsWith('/taf')) return r.fulfill({ body: TAF });
    if (u.pathname.endsWith('/airport')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(AIRPORT) });
    return r.fulfill({ status: 404, body: '' });
  });
  return { browser, page, errors };
}

async function run(viewport, live) {
  const label = `[${viewport.width}px ${live ? 'live' : 'offline'}]`;
  const { browser, page, errors } = await open(viewport, live);
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
  check(/Next lesson/.test(body) && /2\.1 Reading the METAR/.test(body), `${label} course home introduces lesson 2.1`);
  check(await btn('Start lesson 2.1').isVisible(), `${label} Start lesson button visible`);
  check(/Today's real conditions at/.test(body), `${label} daily flight listed`);
  check((await page.locator('.module.planned').count()) === 8 && /being written/.test(body), `${label} eight unwritten modules say so`);
  check(await page.getByRole('list', { name: 'Modules' }).locator('li').count() === 9, `${label} strip shows nine modules`);
  check(!/C172K|N\d{3,5}[A-Z]{0,2}\b/.test(body), `${label} no tail number or type assumed in course copy`);
  await noHScroll('course home');

  // Lesson 2.1, end to end
  await btn('Start lesson 2.1').click();
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
  check((await page.getByText(/^(Best call|Unsafe|Marginal|Acceptable)$/).count()) === 0, `${label} grades hidden before commit`);
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
  check(stored['2.1']?.attempts === 1 && stored['2.1']?.lastGrade === 'best', `${label} lesson 2.1 recorded in course progress`);
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

  // Start 2.2 from the debrief
  await page.getByRole('button', { name: /^Next lesson: 2\.2/ }).click();
  await page.getByRole('heading', { name: 'Two norths' }).waitFor();
  check(/variation/i.test(await main()), `${label} lesson 2.2 starts with the two-norths brief`);
  await btn('Continue').click();
  check((await page.locator('svg[aria-label*="Runway"]').count()) > 0, `${label} 2.2 worked example shows the wind diagram`);
  await btn('Leave lesson').click();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  body = await main();
  check(/2\.2 Wind on the runway/.test(body) && /1 of 40/.test(body), `${label} course home advances to 2.2 with 1 of 40 flown`);

  // Persistence: reload should skip onboarding and keep progress.
  await page.reload();
  await page.getByRole('heading', { name: 'Ground school', exact: true }).waitFor();
  check(/1 of 40/.test(await main()), `${label} progress survives reload, onboarding not shown again`);

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
  await noHScroll('logbook');

  // Tools
  await rail('Tools').click();
  check(await page.locator('svg').filter({ hasText: /lb|in/ }).first().isVisible(), `${label} airplane tool shows the CG chart`);
  await page.getByRole('tab', { name: 'Weather now' }).click();
  await page.locator('.metar').first().waitFor();
  check(new RegExp(`METAR ${icao}`).test(await main()), `${label} weather tool shows the raw METAR`);
  await page.getByRole('tab', { name: 'Review deck' }).click();
  await page.getByRole('group', { name: 'Options' }).getByRole('button').first().click();
  await btn('Reveal').click();
  check(await page.getByText(/14 CFR|PHAK|AIM/).first().isVisible(), `${label} review deck shows a reference after reveal`);
  await noHScroll('tools');

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
  await page.getByRole('button', { name: 'Start lesson 2.1', exact: true }).click();
  await page.getByRole('heading', { name: /Before you leave the house/ }).waitFor();
  body = await page.locator('main').innerText();
  check(/Practice field, not a real airport/.test(body), `${label} lesson header says practice field`);
  check(/KXYZ/.test(body) && !/KASH/.test(body), `${label} lesson report is for the practice field`);
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

try { await runSkip(); } catch (e) { check(false, `[skip setup] crashed: ${e.message.split('\n')[0]}`); }
for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
  for (const live of [true, false]) {
    try { await run(vp, live); } catch (e) { check(false, `[${vp.width}px ${live ? 'live' : 'offline'}] crashed: ${e.message.split('\n')[0]}`); }
  }
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll smoke checks passed');
process.exit(failures.length ? 1 : 0);
