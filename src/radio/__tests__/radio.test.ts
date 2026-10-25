import { describe, expect, it } from 'vitest';
import { hear, pieces } from '../phrase';
import { gradeCall } from '../grade';
import { buildRadioFlight, callsignFor, checkCopy, departureTurn, MISSIONS, type Event, type RadioFlight } from '../flights';
import { RAMPS, CLOSURES, departureRoute, entryFrom, exitsFor, taxiInRoute } from '../field';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { bestRunway } from '../../lib/wind';
import { FIELD } from '../field';

const NOW = new Date('2026-10-25T14:20:00Z');
const owned = { ...sampleC172K, tailNumber: 'N734GT' };
const transmits = (f: RadioFlight) => f.events.filter((e): e is Extract<Event, { kind: 'transmit' }> => e.kind === 'transmit');
const find = (f: RadioFlight, id: string) => transmits(f).find((e) => e.id === id);

function flightWith(mission: Parameters<typeof buildRadioFlight>[0], want: (f: RadioFlight) => boolean): RadioFlight {
  for (let seed = 1; seed < 5000; seed++) {
    const f = buildRadioFlight(mission, seed, blankAircraft, NOW);
    if (want(f)) return f;
  }
  throw new Error('no seed builds that flight');
}

describe('reading a typed call', () => {
  it('folds phonetic letters and spoken numbers', () => {
    expect(hear('November five two X-ray Yankee, runway two four').runs).toEqual(['n52xy', '24']);
    expect(hear('N52XY rwy 24 at A4').runs).toEqual(['n52xy', '24', 'a4']);
    expect(hear('one two one point eight').runs).toEqual(['121.8']);
    expect(hear('ground point eight').runs).toEqual(['.8']);
    expect(hear('two thousand five hundred').runs).toEqual(['2500']);
    expect(hear('ten miles north at 2,500').runs).toEqual(['10', '2500']);
    expect(hear('altimeter three zero zero eight').runs).toEqual(['3008']);
  });
  it('keeps a lower-case a as an article and a capital A as a taxiway', () => {
    expect(hear('request a VFR departure').runs).toEqual([]);
    expect(hear('taxi via A').runs).toEqual(['a']);
  });
  it('splits joined runs into what a controller hears', () => {
    expect(pieces('24a4')).toEqual(['24', 'a4']);
    expect(pieces('121.8')).toEqual(['121.8']);
  });
});

describe('call signs', () => {
  it('uses the pilot tail number and type when set', () => {
    const c = callsignFor(owned);
    expect(c).toMatchObject({ full: '734gt', short: '4gt', sayFull: 'Cessna 734GT', sayShort: 'Cessna 4GT', practice: false });
  });
  it('falls back to a labeled practice tail and November', () => {
    expect(callsignFor(blankAircraft)).toMatchObject({ sayFull: 'November 52XY', practice: true });
  });
});

describe('the practice field', () => {
  it('routes around a closed taxiway by crossing at Charlie', () => {
    const r = departureRoute(RAMPS.main, '06', CLOSURES[0]);
    expect(r).toMatchObject({ via: ['A', 'C', 'B'], cross: { runway: '06', at: 'C' }, holdAt: 'B1', aroundClosure: true });
    expect(departureRoute(RAMPS.main, '24', null)).toMatchObject({ via: ['A'], cross: null, holdAt: 'A4' });
  });
  it('crosses the runway on the way in only when parking is on the far side', () => {
    const south = exitsFor('24').find((e) => e.side === 'south')!;
    expect(south.turn).toBe('left');
    expect(taxiInRoute(south, RAMPS.main, '24').cross).toMatchObject({ runway: '24', at: 'C' });
    expect(taxiInRoute(south, RAMPS.south, '24').cross).toBeNull();
  });
  it('picks a pattern entry on the arrival side, or straight in', () => {
    expect(entryFrom('north', '24')).toEqual({ kind: 'downwind', side: 'right' });
    expect(entryFrom('south', '24')).toEqual({ kind: 'downwind', side: 'left' });
    expect(entryFrom('northeast', '24')).toEqual({ kind: 'straight-in' });
    expect(entryFrom('north', '06')).toEqual({ kind: 'downwind', side: 'left' });
  });
  it('turns toward the departure direction', () => {
    expect(departureTurn('24', 'north')).toBe('right');
    expect(departureTurn('06', 'north')).toBe('left');
    expect(departureTurn('24', 'west')).toBe('straight');
  });
});

describe('radio flights', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 3);
  for (const m of MISSIONS) {
    it(`${m.title}: every model call grades best, across seeds and airplanes`, () => {
      for (const seed of seeds) {
        for (const ac of [blankAircraft, owned]) {
          const f = buildRadioFlight(m.id, seed, ac, NOW);
          const ids = f.events.map((e) => e.id);
          expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
          for (const e of transmits(f)) {
            const r = gradeCall(e.model, e.items, f.callsign);
            const misses = r.items.filter((x) => x.outcome !== 'heard').map((x) => `${x.item.id}:${x.outcome}`);
            expect(misses, `${m.id} ${seed} ${e.id}: "${e.model}"`).toEqual([]);
          }
          for (const e of f.events) {
            if (e.kind === 'decide') expect(Object.values(e.grades)).toContain('best');
          }
        }
      }
    });
  }

  it('the ATIS runway is the one the engine picks for the wind', () => {
    for (const seed of seeds) {
      const { atis } = buildRadioFlight('pattern', seed, null, NOW);
      const want = atis.windMag === null ? '24' : bestRunway(FIELD.runways, atis.windMag, atis.windKt).id;
      expect(atis.runway).toBe(want);
      expect(atis.text).toContain(`information ${atis.word}`);
    }
  });

  it('checks the ATIS copy pad', () => {
    const f = flightWith('pattern', (x) => x.atis.windMag !== null);
    const ev = f.events[0];
    if (ev.kind !== 'atis') throw new Error('first event is the ATIS');
    const field = (id: string) => ev.fields.find((x) => x.id === id)!;
    expect(checkCopy(field('letter'), f.atis, f.atis.word)).toBe(true);
    expect(checkCopy(field('letter'), f.atis, f.atis.letter.toUpperCase())).toBe(true);
    expect(checkCopy(field('altimeter'), f.atis, f.atis.altimeter.replace('.', ''))).toBe(true);
    expect(checkCopy(field('wind'), f.atis, `${f.atis.windMag} at ${f.atis.windKt}`)).toBe(true);
    expect(checkCopy(field('runway'), f.atis, f.atis.runway === '24' ? '06' : '24')).toBe(false);
  });
});

describe('grading what pilots actually say', () => {
  it('stops a taxi readback without the hold short', () => {
    const f = flightWith('pattern', (x) => !find(x, 'taxi-readback')!.atc!.includes('cross'));
    const e = find(f, 'taxi-readback')!;
    const rwy = f.atis.runway;
    const r = gradeCall(`Runway ${rwy}, taxi via ${e.atc!.includes('Bravo') ? 'Bravo' : 'Alpha'}, ${f.callsign.sayShort}`, e.items, f.callsign);
    expect(r.items.find((x) => x.item.id === 'hold-short')!.outcome).toBe('missing');
    expect(r.grade).toBe('marginal');
    expect(r.fix).toMatch(/read back hold short/);
  });

  it('calls a takeoff readback on a line up and wait unsafe', () => {
    const f = flightWith('pattern', (x) => Boolean(find(x, 'luaw')));
    const e = find(f, 'luaw')!;
    const r = gradeCall(`Runway ${f.atis.runway}, cleared for takeoff, ${f.callsign.sayShort}`, e.items, f.callsign);
    expect(r.grade).toBe('unsafe');
    expect(r.fix).toMatch(/not cleared for takeoff/);
  });

  it('catches the wrong runway', () => {
    const f = flightWith('pattern', () => true);
    const e = find(f, 'takeoff')!;
    const wrong = f.atis.runway === '24' ? '6' : '24';
    const r = gradeCall(`Runway ${wrong}, cleared for takeoff, ${f.callsign.sayShort}`, e.items, f.callsign);
    expect(r.items.find((x) => x.item.id.startsWith('runway'))!.outcome).toBe('wrong');
    expect(r.grade).toBe('unsafe');
  });

  it('asks for the call sign when there is none', () => {
    const f = flightWith('pattern', () => true);
    const e = find(f, 'ground-call')!;
    const r = gradeCall(`Practice Ground, at the main ramp with ${f.atis.word}, ready to taxi`, e.items, f.callsign);
    expect(r.fix).toMatch(/say again your call sign/);
  });

  it('accepts spoken and written forms of the same call', () => {
    const f = flightWith('pattern', (x) => x.ramp.id === 'main');
    const e = find(f, 'ground-call')!;
    const spoken = `practice ground november five two x-ray yankee main ramp information ${f.atis.word.toLowerCase()} ready to taxi closed traffic`;
    const written = `Practice Gnd, N52XY, main ramp w/ info ${f.atis.letter.toUpperCase()}, ready to taxi, pattern work`;
    expect(gradeCall(spoken, e.items, f.callsign).grade).toBe('best');
    expect(gradeCall(written, e.items, f.callsign).items.find((x) => x.item.id === 'atis')!.outcome).toBe('heard');
  });

  it('accepts the short call sign only once the controller has used it', () => {
    const f = flightWith('pattern', () => true);
    const first = find(f, 'tower-ready')!;
    const r = gradeCall(`Practice Tower, ${f.callsign.sayShort}, holding short runway ${f.atis.runway}, ready`, first.items, f.callsign);
    expect(r.items.find((x) => x.item.id === 'callsign')!.outcome).toBe('missing');
  });

  it('marks a wrong ATIS code wrong, and the controller gives the current one', () => {
    const f = flightWith('pattern', (x) => x.atis.letter !== 'd');
    const e = find(f, 'ground-call')!;
    const r = gradeCall(`Practice Ground, ${f.callsign.sayFull}, main ramp, information Delta, ready to taxi`, e.items, f.callsign);
    expect(r.items.find((x) => x.item.id === 'atis')!.outcome).toBe('wrong');
    expect(r.grade).toBe('marginal');
    expect(r.fix).toMatch(/is current/);
  });
});

describe('scoring a radio flight', () => {
  it('grades a call on the first try, and allows one more after a correction', async () => {
    const { emptyRadioAnswers, eventDone, scoreRadio, transmitState } = await import('../session');
    const f = flightWith('pattern', (x) => !find(x, 'taxi-readback')!.atc!.includes('cross'));
    const e = find(f, 'taxi-readback')!;
    const bad = `Runway ${f.atis.runway}, ${f.callsign.sayShort}`;
    expect(transmitState(f, e, [bad])).toBe('retry');
    expect(transmitState(f, e, [bad, bad])).toBe('done');
    expect(transmitState(f, e, [bad, e.model])).toBe('done');
    const a = emptyRadioAnswers();
    a.calls[e.id] = [bad, e.model];
    expect(eventDone(f, e, a)).toBe(true);
    const s = scoreRadio(f, a);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ grade: 'marginal', tries: 2 });
    expect(s.calls[0].last.grade).toBe('best');
    expect(s.grade).toBe('marginal');
  });

  it('a flight flown with the model calls and the best decisions grades best', async () => {
    const { emptyRadioAnswers, scoreRadio } = await import('../session');
    for (const m of MISSIONS) {
      const f = buildRadioFlight(m.id, 42, owned, NOW);
      const a = emptyRadioAnswers();
      for (const e of f.events) {
        if (e.kind === 'transmit') a.calls[e.id] = [e.model];
        if (e.kind === 'decide') a.decisions[e.id] = Object.entries(e.grades).find(([, g]) => g === 'best')![0];
        if (e.kind === 'atis') for (const x of e.fields) a.copy[x.id] = x.answer;
      }
      const s = scoreRadio(f, a);
      expect(s.grade).toBe('best');
      expect(s.copyRight).toBe(s.copyTotal);
      expect(s.clean).toBe(s.calls.length);
    }
  });
});

describe('the way pilots really type', () => {
  const f = flightWith('pattern', (x) => x.ramp.id === 'main' && x.atis.runway === '24' && !find(x, 'taxi-readback')!.atc!.includes('cross'));
  const g = (id: string, text: string) => gradeCall(text, find(f, id)!.items, f.callsign);
  it('reads shorthand readbacks', () => {
    expect(g('taxi-readback', '24 via alpha, hold short 24 at alpha 4, 2xy').grade).toBe('best');
    expect(g('taxi-readback', 'Hold short of runway two four at Alpha four, via Alpha, November two X-ray Yankee').grade).toBe('best');
    expect(g('taxi-readback', 'rwy 24 via A hold short @ A4 N2XY').grade).toBe('best');
  });
  it('reads a ready call that names the spot instead of saying holding short', () => {
    expect(g('tower-ready', `Practice Tower, N52XY, at Alpha 4 for runway 24, ready for take-off, closed traffic`).grade).toBe('best');
  });
  it('flags a taxiway that was not in the clearance', () => {
    const r = g('taxi-readback', 'Runway 24 via Bravo, hold short 24 at Alpha 4, 2XY');
    expect(r.items.find((x) => x.item.id === 'route')!.outcome).toBe('wrong');
    expect(r.grade).toBe('marginal');
  });
});
