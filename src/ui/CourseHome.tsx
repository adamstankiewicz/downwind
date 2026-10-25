// Course home: where you are in the nine modules, the next lesson introduced
// in the instructor's voice, today's real conditions as a standing flight,
// lessons worth flying again, and the whole syllabus as a taxiway: a yellow
// centerline from module sign to module sign, with a hoop for every lesson.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Airport } from '../data/airports';
import type { Lesson, Module } from '../course/types';
import { modules } from '../course/modules';
import { coachLevel, courseProgress, isDone, moduleProgress, nextLesson, toRefly, type CourseProgress } from '../course/progress';
import { GRADE_LABEL, Voice } from './common';
import { Strip } from './Strip';

export function CourseHome({ progress, airport, hasAircraft, onStart, onDaily, onSetup }: {
  progress: CourseProgress;
  airport: Airport | null;
  hasAircraft: boolean;
  onStart: (lesson: Lesson) => void;
  onDaily: () => void;
  onSetup: () => void;
}) {
  const next = nextLesson(progress);
  const refly = toRefly(progress).filter((l) => l.id !== next?.id);
  const total = courseProgress(progress);
  const currentModule = next ? next.module : modules.find((m) => moduleProgress(progress, m).done < moduleProgress(progress, m).total)?.n ?? 9;
  const points = modules.map((m) => {
    const p = moduleProgress(progress, m);
    const state = m.lessons.length > 0 && p.done === p.total ? 'done' : m.n === currentModule ? 'now' : 'todo';
    return { id: String(m.n), label: `${m.n}`, sub: m.title, state: state as 'done' | 'now' | 'todo' };
  });
  const flown = Object.keys(progress).length;

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <h1>Ground school</h1>
          <span className="muted">{total.done} of {total.total} lessons flown. Module {currentModule} of 9.</span>
        </div>
        <Strip points={points} label="Modules" />
      </div>

      <div className="home">
        <div className="home-main">
          {next ? <NextLesson lesson={next} progress={progress} airport={airport} onStart={onStart} flown={flown} /> : <AllDone />}

          <section className="also">
            <h2>Also today</h2>
            <button type="button" className="sess" onClick={airport ? onDaily : onSetup}>
              <b>Today's real conditions{airport ? ` at ${airport.icao}` : ''}</b>
              <span className="d">
                {airport
                  ? flown
                    ? 'Fly the go/no-go with the live report and the lessons you have so far. Lines the course has covered ask for your reading first.'
                    : 'Fly the go/no-go with the live report. Until you have flown a lesson, the sheet is filled in for you and nothing is asked.'
                  : 'Needs a home airport. Set one and the daily flight pulls its live weather.'}
              </span>
              <span className="t">{airport ? 'Daily' : 'Set up'}</span>
            </button>
            {refly.length > 0 && (
              <>
                {refly.map((l) => (
                  <button type="button" key={l.id} className="sess refly" onClick={() => onStart(l)}>
                    <b>Fly {l.id} again: {l.title}</b>
                    <span className="d">Last time: {GRADE_LABEL[progress[l.id].lastGrade].toLowerCase()}. {l.minutes} min.</span>
                    <span className="t">Again</span>
                  </button>
                ))}
              </>
            )}
          </section>
        </div>

        <section className="course-list">
          <h2>The course</h2>
          <ol className="modules">
            {modules.map((m) => <ModuleRow key={m.n} m={m} progress={progress} onStart={onStart} current={m.n === currentModule} nextId={next?.id ?? null} />)}
          </ol>
          <p className="help">Nine modules in the order of the Private Pilot ACS. The daily flight only asks about what the lessons you have flown have covered.{!hasAircraft ? ' Lessons that need the airplane\'s numbers use what you have entered and say when something is missing.' : ''}</p>
        </section>
      </div>
    </>
  );
}

function NextLesson({ lesson, progress, airport, onStart, flown }: { lesson: Lesson; progress: CourseProgress; airport: Airport | null; onStart: (l: Lesson) => void; flown: number }) {
  const m = modules.find((x) => x.n === lesson.module)!;
  const idx = m.lessons.findIndex((l) => l.id === lesson.id);
  const after = m.lessons[idx + 1];
  const level = coachLevel(progress, lesson);
  const field = airport && airport.runways.length > 0 ? airport.icao : null;
  const intro = flown === 0
    ? `This is where the course starts. ${field ? `Every lesson is a short flight out of ${field}, built with your runways and your minimums.` : 'Until you set a home field with runways, lessons fly from a practice field, and say so.'} I brief, I work one example, then you take the controls. ${lesson.summary}`
    : level === 'full'
      ? `${lesson.summary} ${field ? `Same field, ${field}, your numbers.` : 'Practice field, your numbers.'} I will work the first one, you take the second.`
      : `${lesson.summary} You know the pattern by now: I brief briefly, you do the work.`;

  return (
    <section className="next">
      <h2>Next lesson</h2>
      <p className="next-meta">Module {m.n}, {m.title}. Lesson {idx + 1} of {m.lessons.length}. {lesson.acs.join(', ')}.</p>
      <h3 className="next-title"><span className="lid">{lesson.id}</span> {lesson.title}</h3>
      <Voice>{intro}</Voice>
      <dl className="next-facts">
        <div><dt>About</dt><dd>{lesson.minutes} min</dd></div>
        <div><dt>Then</dt><dd>{after ? `${after.id} ${after.title}` : 'End of the module'}</dd></div>
      </dl>
      <div className="cta">
        <button type="button" className="btn primary lg" onClick={() => onStart(lesson)}>Start lesson {lesson.id}</button>
        <span className="hint">{progress[lesson.id] ? 'Flown before. A new attempt is recorded alongside.' : 'About the same length as a thorough preflight.'}</span>
      </div>
    </section>
  );
}

function AllDone() {
  return (
    <section className="next">
      <h2>Next lesson</h2>
      <h3 className="next-title">Every lesson is flown</h3>
      <Voice>That is the whole course. Fly the daily flight to keep the habit, fly any lesson again from the list below, and print your flight review summary from the logbook for your CFI.</Voice>
    </section>
  );
}

const Check = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** One module: its taxiway sign, then the path through its lessons. The
 *  current module is a location sign (taxi on black), one still to come a
 *  direction sign (black on taxi), one finished a plain panel with a check. */
function ModuleRow({ m, progress, onStart, current, nextId }: { m: Module; progress: CourseProgress; onStart: (l: Lesson) => void; current: boolean; nextId: string | null }) {
  const p = moduleProgress(progress, m);
  const written = m.lessons.length > 0;
  const done = written && p.done === p.total;
  return (
    <li className={`module ${current ? 'current' : ''} ${written ? '' : 'planned'} ${done ? 'done' : ''}`}>
      <details open={current}>
        <summary className={`sign ${current ? 'here' : done ? 'was' : 'next'}`}>
          <span className="m-n" aria-hidden="true">{done ? Check : m.n}</span>
          <span className="m-title">
            <b>{m.title}</b>
            <small>{m.summary}</small>
          </span>
          <span className="m-count">{written ? `${p.done} of ${p.total}` : 'being written'}</span>
        </summary>
        <TaxiPath>
          {written
            ? m.lessons.map((l) => {
              const r = progress[l.id];
              const state = isDone(progress, l.id) ? 'done' : l.id === nextId ? 'current' : r ? 'flown' : 'open';
              return (
                <li key={l.id} className={state}>
                  <button type="button" className="lrow" onClick={() => onStart(l)}>
                    <span className="node" aria-hidden="true">{state === 'done' ? Check : l.id}</span>
                    <span className="l-title"><span className="lid">{l.id}</span> {l.title}</span>
                    <span className={`l-state ${r ? r.lastGrade : state === 'current' ? 'now' : ''}`}>
                      {r ? `${GRADE_LABEL[r.lastGrade]}${r.attempts > 1 ? `, ${r.attempts} attempts` : ''}` : state === 'current' ? `Flyable now, ${l.minutes} min` : `${l.minutes} min`}
                    </span>
                    <span className="vh">{r ? ', fly again' : ', start'}</span>
                  </button>
                </li>
              );
            })
            : m.outline.map((t, i) => (
              <li key={t} className="coming">
                <div className="lrow">
                  <span className="node" aria-hidden="true">{m.n}.{i + 1}</span>
                  <span className="l-title"><span className="lid">{m.n}.{i + 1}</span> {t}</span>
                  <span className="l-state coming">Coming</span>
                </div>
              </li>
            ))}
        </TaxiPath>
        <p className="m-acs">ACS areas {m.acsAreas.join(', ')}</p>
      </details>
    </li>
  );
}

/** Sign-to-sign centerline. The line enters from the sign's number square
 *  above, winds through every hoop (measured after layout so wrapped titles
 *  never break it) and leaves toward the next sign below. */
const SIGN_X = 26;

function TaxiPath({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState({ d: '', w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const pts = Array.from(el.querySelectorAll<HTMLElement>('.node')).map((n) => {
        const b = n.getBoundingClientRect();
        return [b.left + b.width / 2 - box.left, b.top + b.height / 2 - box.top];
      });
      const r = (v: number) => Math.round(v * 10) / 10;
      let prev: [number, number] = [SIGN_X, 0];
      let d = `M ${SIGN_X} 0`;
      for (const [x, y] of [...pts, [SIGN_X, box.height]]) {
        const my = r((prev[1] + y) / 2);
        d += ` C ${r(prev[0])} ${my}, ${r(x)} ${my}, ${r(x)} ${r(y)}`;
        prev = [x, y];
      }
      setGeo((g) => (g.d === d ? g : { d, w: Math.round(box.width), h: Math.round(box.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div className="path" ref={ref}>
      {geo.w > 0 && (
        <svg className="path-line" aria-hidden="true" focusable="false" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`}>
          <path d={geo.d} className="edge" />
          <path d={geo.d} className="paint" />
        </svg>
      )}
      <ol className="lessons">{children}</ol>
    </div>
  );
}
