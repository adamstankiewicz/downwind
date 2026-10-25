// Lesson 2.6, Hazards along the route: AIRMETs, SIGMETs and pilot reports.
// An advisory paints a big area with a forecast; the PIREPs say what
// airplanes are actually meeting, and a large airplane's "moderate" is worse
// in a trainer. The trip is on the practice sectional, from the practice
// field over the ridges to Ridgeback. Grades come from lib/hazards.ts.

import { chartAirport } from '../chart/practiceRegion';
import { ADVISORY_COVERS, ADVISORY_NAMES, feltInLight, gradeHazard, type Advisory, type HazardCase, type HazardOption } from '../lib/hazards';
import type { Grade } from '../scenarios/goNoGo';
import type { Lesson } from './types';

/** Copy written for the intended grade; when the engine grades it otherwise, say what the engine saw. */
function follow<T extends string>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) out[id] = !intended[id] || intended[id] === grades[id] ? written[id] : why(id);
  return out;
}

export interface RouteHazard {
  hazard: HazardCase;
  title: string;
  /** The advisory as the briefing reads it. */
  advisoryText: string;
  /** Raw PIREPs near the route. */
  pireps: string[];
  scene: string;
  labels: Record<HazardOption, string>;
  intended: Record<HazardOption, Grade>;
  written: Record<HazardOption, string>;
  why: string;
}

const TANGO = 'AIRMET TANGO FOR TURB VALID UNTIL 2100. MOD TURB BLW 080 OVER THE RIDGES WEST AND SOUTHWEST OF THE PRACTICE FIELD. CONDS CONTG BYD 2100.';

export function routeHazard(v: number): RouteHazard {
  if (v === 1) {
    return {
      hazard: { advisory: 'airmet-tango', pireps: [{ intensity: 'moderate', aircraft: 'large', altFt: 6000 }, { intensity: 'moderate', aircraft: 'light', altFt: 3500 }], avoidable: false },
      title: 'Two reports, two airplanes',
      advisoryText: TANGO,
      pireps: ['UA /OV XYZ210025/TM 1440/FL060/TP CRJ9/TB MOD', 'UA /OV XRB/TM 1505/FL035/TP PA28/TB MOD/RM LOST 400 FT IN DOWNDRAFT'],
      scene: 'The same AIRMET Tango as last week. This time a regional jet reports moderate turbulence at 6,000 over the ridge, and a Piper on its way into Ridgeback reports moderate at 3,500 and a 400 foot downdraft. The wind at Ridgeback is 25 knots across the ridge.',
      labels: {
        go: 'Go. Moderate is within the airplane\'s limits.',
        deviate: 'Go, but slow to maneuvering speed over the ridge.',
        delay: 'Wait for the wind to ease and check again later.',
        cancel: 'Cancel the trip for today.',
      },
      intended: { go: 'unsafe', deviate: 'marginal', delay: 'best', cancel: 'acceptable' },
      written: {
        go: 'The jet\'s moderate is worse in your airplane, and a light airplane already met moderate with a 400 foot downdraft at the altitude you would fly, downwind of the ridge you have to cross. That is what the AIRMET looks like when it verifies.',
        deviate: 'Slowing to Va protects the structure. It does nothing about a downdraft on the lee side of the ridge, and there is no route that avoids the ridge.',
        delay: 'Right. Two reports confirm the forecast, and one is from an airplane like yours. Mountain wave and rotor ease as the wind drops, often by evening. Check the PIREPs again then.',
        cancel: 'Sound. Nothing about the trip is worth a fight with the ridge. Waiting a few hours might have got you there today.',
      },
      why: 'The AIRMET says moderate turbulence is possible over a wide area. The PIREPs say it is there: a jet\'s moderate is felt as severe in a light airplane (AIM 7-1-21), and a trainer met it at your altitude. When the reports confirm the forecast, wait.',
    };
  }
  if (v === 2) {
    return {
      hazard: { advisory: 'airmet-sierra', pireps: [], avoidable: true },
      title: 'Ridges in cloud',
      advisoryText: 'AIRMET SIERRA FOR IFR AND MTN OBSCN VALID UNTIL 1800. RIDGES W AND SW OF THE PRACTICE FIELD OBSC IN CLDS. CIGS BLW 010 OVER HIGHER TERRAIN. CONDS IMPRG AFT 1800.',
      pireps: ['UA /OV XYZ240015/TM 1310/FL030/TP DA40/SK OVC035/RM VALLEY VFR, RIDGETOPS IN CLOUD'],
      scene: 'An AIRMET Sierra covers the ridges on your direct route. A Diamond DA40 in the valley reports an overcast at 3,500, VFR underneath, ridgetops in cloud. The METARs at both ends are VFR, and the valley route south adds 15 minutes.',
      labels: {
        go: 'Fly direct. Both ends are reporting VFR.',
        deviate: 'Take the valley route, south of the cloud.',
        delay: 'Wait until the AIRMET ends at 1800.',
        cancel: 'Cancel. An AIRMET Sierra is on the route.',
      },
      intended: { go: 'unsafe', deviate: 'best', delay: 'acceptable', cancel: 'acceptable' },
      written: {
        go: 'VFR at both ends says nothing about the middle. Direct puts you over ridges in cloud, squeezed between the terrain and the overcast. That is how VFR flight into IMC starts.',
        deviate: 'Right. The AIRMET is about the ridges, and the PIREP shows the valley is open. Fifteen minutes longer, with the overcast above you and the terrain well below. Keep a turn back in your pocket if the valley closes.',
        delay: 'Safe, and maybe necessary if the valley fills in. Today a VFR route exists, and the PIREP shows it.',
        cancel: 'Never wrong, but an AIRMET is a forecast over a big area, not a closed sign. Read where it is and look for a way around it.',
      },
      why: 'An AIRMET Sierra warns of IFR and mountain obscuration over an area. Plot it against the route: when the hazard is the high ground and a valley route stays VFR (the PIREP and the METARs say it does), go around it, with a turn back ready.',
    };
  }
  if (v === 3) {
    return {
      hazard: { advisory: 'convective-sigmet', pireps: [], avoidable: false },
      title: 'A line on the way',
      advisoryText: 'CONVECTIVE SIGMET 22E VALID UNTIL 1655Z. LINE TS 30 NM WIDE MOV FROM 26025KT. TOPS ABV FL400. HAIL TO 1 IN, WIND GUSTS TO 55KT POSS.',
      pireps: ['UA /OV XRB/TM 1420/FL050/TP BE36/RM TS W OF XRB, DEVIATING E'],
      scene: 'A convective SIGMET: a line of thunderstorms moving east at 25 knots, crossing your route in about an hour. A Bonanza west of Ridgeback is deviating east, away from it. There is a gap in the line on the radar picture, south of your route.',
      labels: {
        go: 'Go now and land before the line gets there.',
        deviate: 'Fly to the gap in the line south of the route.',
        delay: 'Wait for the line to pass, then go.',
        cancel: 'Cancel for the day.',
      },
      intended: { go: 'unsafe', deviate: 'unsafe', delay: 'best', cancel: 'acceptable' },
      written: {
        go: 'You would arrive just ahead of the line, in the gust front that runs miles ahead of it, landing at a field with no fuel and nowhere to go but back into the storm.',
        deviate: 'A gap on the radar picture is minutes old, and lines fill in. The AIM says to avoid a severe storm by at least 20 miles; a gap in a line is closer than that on both sides.',
        delay: 'Right. Lines move through. Wait until it is well past both fields, then go in the clear, cool air behind it. Check for new cells building behind the line first.',
        cancel: 'Sound, if the day is done. Behind a line the weather is often the best of the day, so waiting may still get you there.',
      },
      why: 'A convective SIGMET is the one you plan around in time, not in space: stay 20 miles from severe storms (AIM 7-1-27), never try to beat a line or slip through a gap, and let it pass.',
    };
  }
  return {
    hazard: { advisory: 'airmet-tango', pireps: [{ intensity: 'light', aircraft: 'light', altFt: 4500 }], avoidable: true },
    title: 'The AIRMET and the PIREP',
    advisoryText: TANGO,
    pireps: ['UA /OV XYZ220020/TM 1445/FL045/TP DA40/TB LGT CHOP/RM SMOOTH ABV 055'],
    scene: 'An AIRMET Tango for moderate turbulence below 8,000 covers the ridges on your route. Half an hour ago a Diamond DA40 over the ridge at 4,500 reported light chop, smooth above 5,500. The wind at Ridgeback is 10 knots, straight down the runway.',
    labels: {
      go: 'Go, planning 5,500 and a slower speed if it gets rough.',
      deviate: 'Take the longer valley route, away from the ridges.',
      delay: 'Wait for the AIRMET to expire before going.',
      cancel: 'Cancel. An AIRMET is out for the route.',
    },
    intended: { go: 'best', deviate: 'acceptable', delay: 'acceptable', cancel: 'marginal' },
    written: {
      go: 'Right. The AIRMET covers the whole region; the PIREP is the truth on your route, from an airplane like yours, half an hour old. Plan the smooth altitude, slow to Va if it bumps, and keep checking PIREPs on the way.',
      deviate: 'Fine, and longer than it needs to be. The report from over the ridge was light chop.',
      delay: 'Safe. This AIRMET runs past 2100, though, and the reports say the route is flyable now.',
      cancel: 'An AIRMET for moderate turbulence isn\'t a closed sign. Pilots who cancel for every AIRMET Tango in the hills never fly in the spring, and never learn what moderate means.',
    },
    why: 'An AIRMET is a forecast over a large area for conditions that may be there. A PIREP from an airplane like yours at your altitude is the best evidence there is. Use the AIRMET to know what to look for, and the PIREPs to decide.',
  };
}

const CASES = 4;

export const hazardsLesson: Lesson = {
  id: '2.6', module: 2, minutes: 15,
  title: 'Hazards along the route',
  summary: 'AIRMETs, SIGMETs and pilot reports: what each covers, why a forecast over a big area isn\'t the whole story, and how to decide with the PIREPs.',
  acs: ['PA.I.C'],
  refs: ['AIM 7-1-6', 'AIM 7-1-18', 'AIM 7-1-21', 'AIM 7-1-27'],
  variants: CASES,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, CASES - 1);
    const rh = routeHazard(v);
    const grades = gradeHazard(rh.hazard);
    const field = chartAirport('KXRB')!;
    const names = (Object.keys(ADVISORY_NAMES) as Advisory[]).map((a) => ADVISORY_NAMES[a]);
    const felt = feltInLight({ intensity: 'moderate', aircraft: 'large', altFt: 6000 });
    return [
      {
        kind: 'brief', id: 'b1', title: 'Between the two METARs',
        scene: `A Saturday trip from the practice field to ${field.name}, ${field.elevationFt.toLocaleString('en-US')} feet up in the hills on the practice sectional, with a ridge in between.`,
        figure: { kind: 'chart', route: ['KXYZ', 'KXRB'] },
        say: {
          full: 'METARs and TAFs cover the airports. What happens between them is in the **inflight advisories**. **AIRMETs** are for weather that matters to light airplanes: **Sierra** for IFR and mountain obscuration, **Tango** for moderate turbulence, strong surface winds and low-level wind shear, **Zulu** for moderate icing and the freezing level. **SIGMETs** are for severe icing, severe or extreme turbulence and volcanic ash, and **convective SIGMETs** for thunderstorms. All of them are forecasts over a large area. **PIREPs** are reports from pilots of what they actually met, where and when, and they are the best weather information there is. A report from a jet reads differently from one from a trainer.',
          short: 'AIRMETs and SIGMETs forecast an area; PIREPs say what is really there.',
        },
      },
      {
        kind: 'example', id: 'e1', title: 'Reading a PIREP',
        say: {
          full: 'PIREPs come in a fixed order, each part behind a slash. **UA** is routine, **UUA** urgent: severe turbulence or icing, wind shear, hail. The location is a bearing and distance from a navaid or airport.',
          short: 'Slash by slash.',
        },
        work: [
          { label: 'Report', value: 'UA /OV XYZ220020/TM 1445/FL045/TP DA40/TB LGT CHOP/RM SMOOTH ABV 055' },
          { label: 'UA', value: 'Routine report', note: 'UUA would be urgent' },
          { label: '/OV XYZ220020', value: '20 nm from XYZ on the 220 radial', note: 'Over the ridge on your route' },
          { label: '/TM 1445', value: '1445 Zulu' },
          { label: '/FL045', value: '4,500 feet MSL' },
          { label: '/TP DA40', value: 'A Diamond DA40', note: 'A light airplane, so its intensity reads like yours' },
          { label: '/TB LGT CHOP', value: 'Light chop' },
          { label: '/RM SMOOTH ABV 055', value: 'Remarks: smooth above 5,500' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Which advisory would warn you about each of these?',
        blanks: [
          { id: 'tango', label: 'Moderate turbulence below 8,000 over the hills', answer: ADVISORY_NAMES['airmet-tango'], choices: names, explain: `AIRMET Tango: ${ADVISORY_COVERS['airmet-tango'].toLowerCase()}.` },
          { id: 'sierra', label: 'Ceilings under 1,000 and the ridges in cloud', answer: ADVISORY_NAMES['airmet-sierra'], choices: names, explain: `AIRMET Sierra: ${ADVISORY_COVERS['airmet-sierra'].toLowerCase()}.` },
          { id: 'zulu', label: 'Moderate icing in cloud, freezing level 4,000', answer: ADVISORY_NAMES['airmet-zulu'], choices: names, explain: `AIRMET Zulu: ${ADVISORY_COVERS['airmet-zulu'].toLowerCase()}.` },
          { id: 'sigmet', label: 'Severe turbulence', answer: ADVISORY_NAMES.sigmet, choices: names, explain: `SIGMET: ${ADVISORY_COVERS.sigmet.toLowerCase()}.` },
          { id: 'conv', label: 'A line of thunderstorms', answer: ADVISORY_NAMES['convective-sigmet'], choices: names, explain: `Convective SIGMET: ${ADVISORY_COVERS['convective-sigmet'].toLowerCase()}.` },
          { id: 'uua', label: 'A PIREP that starts with UUA is', answer: 'Urgent', choices: ['Routine', 'Urgent', 'An update', 'Unverified'], explain: 'UUA marks an urgent PIREP: severe weather, wind shear, hail, or anything else hazardous right now (AIM 7-1-18).' },
          { id: 'jet', label: 'A regional jet reports moderate turbulence. In a light trainer, expect it to feel', answer: felt === 'severe' ? 'Worse' : 'The same', choices: ['Lighter', 'The same', 'Worse'], explain: 'Turbulence intensity is reported for the airplane that met it (AIM 7-1-21). A big, heavy airplane rides through what throws a trainer around.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: rh.title,
        situation: rh.scene,
        figure: {
          kind: 'reports',
          reports: [{ label: ADVISORY_NAMES[rh.hazard.advisory], raw: rh.advisoryText }, ...rh.pireps.map((raw) => ({ label: raw.startsWith('UUA') ? 'Urgent PIREP' : 'PIREP', raw }))],
          caption: 'Practice advisories and pilot reports written for this lesson, for an area on the practice sectional.',
        },
        options: (['go', 'deviate', 'delay', 'cancel'] as HazardOption[]).map((id) => ({ id, label: rh.labels[id] })),
        grades,
        consequence: follow(grades, rh.intended, rh.written, (id) => `That grades ${grades[id]} with these reports.`),
        why: rh.why,
      },
    ];
  },
};
