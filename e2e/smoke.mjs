// End-to-end smoke test. Run against a preview build:
//   npm run build && npx vite preview --port 4173 &
//   node e2e/smoke.mjs [http://localhost:4173]
// Weather and airport requests are stubbed, so it runs offline and exercises
// both the live path and the sample fallback.
import { createRequire } from 'node:module';

// Plain require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const METAR = 'METAR KPSM 241656Z 32008KT 10SM FEW045 16/02 A3008 RMK AO2';
const TAF = 'TAF KPSM 241720Z 2418/2518 32010KT P6SM FEW050 FM250000 VRB03KT P6SM SKC';
const AIRPORT = [{ icaoId: 'KPSM', name: 'PORTSMOUTH INTL AT PEASE', state: 'NH', elev: 30, magdec: '15W', runways: [{ id: '16/34', alignment: '160' }] }];

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

async function run(viewport, live) {
  const label = `[${viewport.width}px ${live ? 'live' : 'offline'}]`;
  const browser = await chromium.launch();
  // Block the service worker so page.route sees every API request.
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/awc/**', (r) => {
    if (!live) return r.fulfill({ status: 500, body: 'down' });
    const u = new URL(r.request().url());
    if (u.pathname.endsWith('/metar')) return r.fulfill({ body: METAR });
    if (u.pathname.endsWith('/taf')) return r.fulfill({ body: TAF });
    if (u.pathname.endsWith('/airport')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(AIRPORT) });
    return r.fulfill({ status: 404, body: '' });
  });
  const noHScroll = async (where) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= viewport.width, `${label} no horizontal scroll on ${where} (${w}px)`);
  };
  const btn = (name) => page.getByRole('button', { name, exact: true });

  // Onboarding
  await page.goto(BASE);
  await btn('Set up').click();
  const ident = live ? 'PSM' : 'ASH';
  const input = page.getByLabel(/identifier/i).first();
  await input.fill(ident);
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
  await page.getByRole('button', { name: new RegExp(`Open Today at ${icao}`) }).click();

  // Today
  await page.getByRole('heading', { name: new RegExp(`Today at ${icao}`, 'i') }).waitFor();
  check(true, `${label} landed on Today at ${icao}`);
  check((await page.getByText(/Sample weather/i).count()) === (live ? 0 : 1), `${label} sample-weather notice ${live ? 'absent' : 'present'}`);
  check(await page.getByText(/Sample airplane/i).first().isVisible(), `${label} sample-airplane notice present`);
  if (live) {
    check(await page.getByText(/320°T becomes 335°M/).first().isVisible(), `${label} true-to-magnetic conversion uses KPSM variation`);
    check(!/KASH|Nashua|Boire/.test(await page.locator('body').innerText()), `${label} no KASH text when the pilot chose KPSM`);
  }
  await noHScroll('Today');
  check(await btn('Commit').isDisabled(), `${label} Commit disabled before a choice`);
  check((await page.getByText(/^(Best|Unsafe)$/).count()) === 0, `${label} grades hidden before commit`);
  await page.getByRole('button', { name: /Go as planned/ }).click();
  await btn('Commit').click();
  await page.getByText(/Debrief/i).first().waitFor();
  const body = await page.locator('main').innerText();
  check(/Manage\/Decide|Perform|Practice|Explain/.test(body), `${label} debrief shows LCG level`);
  check(live ? /best/i.test(body) : /confidently wrong|unsafe/i.test(body), `${label} grade matches conditions`);

  // Persistence: reload should skip onboarding.
  await page.reload();
  await page.getByRole('heading', { name: new RegExp(`Today at ${icao}`, 'i') }).waitFor();
  check(true, `${label} onboarding not shown again after reload`);

  // Airplane
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Airplane/ }).click();
  check(await page.locator('svg').filter({ hasText: /lb|in/ }).first().isVisible(), `${label} CG chart renders`);
  await noHScroll('Airplane');

  // Review
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Review/ }).click();
  await page.getByRole('group', { name: 'Options' }).getByRole('button').first().click();
  await btn('Reveal').click();
  check(await page.getByText(/14 CFR|PHAK|AIM/).first().isVisible(), `${label} review shows a reference after reveal`);

  // Readiness
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Readiness/ }).click();
  check(/1 answered|answered 1|1 of/i.test(await page.locator('main').innerText()), `${label} readiness counts the answer`);

  // Settings
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Settings/ }).click();
  check(await btn('Run setup again').isVisible(), `${label} settings offers Run setup again`);
  check(await page.getByText(/Not for navigation/).first().isVisible(), `${label} disclaimer visible`);
  await noHScroll('Settings');

  check(errors.length === 0, `${label} no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

// A fresh install that skips setup must land on Today asking for a home airport.
async function runSkip() {
  const label = '[skip setup]';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/awc/**', (r) => r.fulfill({ status: 500, body: 'down' }));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  const body = await page.locator('main').innerText();
  check(/home airport/i.test(body), `${label} Today asks for a home airport`);
  check(!/KASH|Nashua|C172/.test(body), `${label} no bundled airport or airplane assumed`);
  check(await page.getByRole('button', { name: 'Set home airport', exact: true }).isVisible(), `${label} offers to set the home airport`);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Airplane/ }).click();
  check(await page.getByText(/No airplane yet/).first().isVisible(), `${label} Airplane screen shows the not-set-up state`);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Settings/ }).click();
  check(await page.getByText(/No home airport yet/).first().isVisible(), `${label} Settings shows no home airport`);
  check(errors.length === 0, `${label} no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

try { await runSkip(); } catch (e) { check(false, `[skip setup] crashed: ${e.message.split('\n')[0]}`); }
for (const vp of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
  for (const live of [true, false]) {
    try { await run(vp, live); } catch (e) { check(false, `[${vp.width}px ${live ? 'live' : 'offline'}] crashed: ${e.message.split('\n')[0]}`); }
  }
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll smoke checks passed');
process.exit(failures.length ? 1 : 0);
