// Course home: where you are in the nine modules, the next lesson introduced
// in the instructor's voice, today's real conditions as a standing flight,
// lessons worth flying again, and the whole syllabus with each lesson's state.

import type { Airport } from '../data/airports';
import type { Lesson, Module } from '../course/types';
import { modules } from '../course/modules';
import { coachLevel, courseProgress, isDone, moduleProgress, nextLesson, toRefly, type CourseProgress } from '../course/progress';
import { GRADE_LABEL } from './common';
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
                    <span className="d">Last time: {GRADE_LABEL[progress[l.id].lastGrade].toLowerCase()}{progress[l.id].confidentlyWrong ? ', and you were sure of it' : ''}. {l.minutes} min.</span>
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
            {modules.map((m) => <ModuleRow key={m.n} m={m} progress={progress} onStart={onStart} current={m.n === currentModule} />)}
          </ol>
          <p className="help">Nine modules in the order of the Private Pilot ACS. Modules marked "being written" show their planned lessons; the daily flight only asks what the written ones have covered.{!hasAircraft ? ' Lessons that need the airplane\'s numbers use what you have entered and say when something is missing.' : ''}</p>
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
      <p className="voice">{intro}</p>
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
      <h3 className="next-title">Every written lesson is flown</h3>
      <p className="voice">The rest of the course is being written. Fly the daily flight to keep the habit, and fly any lesson again from the list below.</p>
    </section>
  );
}

function ModuleRow({ m, progress, onStart, current }: { m: Module; progress: CourseProgress; onStart: (l: Lesson) => void; current: boolean }) {
  const p = moduleProgress(progress, m);
  const written = m.lessons.length > 0;
  return (
    <li className={`module ${current ? 'current' : ''} ${written ? '' : 'planned'}`}>
      <details open={current}>
        <summary>
          <span className="m-n">{m.n}</span>
          <span className="m-title">
            <b>{m.title}</b>
            <small>{m.summary}</small>
          </span>
          <span className="m-count">{written ? `${p.done} of ${p.total}` : 'being written'}</span>
          <span className="m-bar" aria-hidden="true"><i style={{ width: written && p.total ? `${(p.done / p.total) * 100}%` : '0%' }} /></span>
        </summary>
        <ol className="lessons">
          {written
            ? m.lessons.map((l) => {
              const r = progress[l.id];
              return (
                <li key={l.id} className={isDone(progress, l.id) ? 'done' : ''}>
                  <span className="l-id">{l.id}</span>
                  <span className="l-title">{l.title}<small>{l.summary}</small></span>
                  <span className={`l-state ${r ? r.lastGrade : ''}`}>{r ? `${GRADE_LABEL[r.lastGrade]}${r.attempts > 1 ? `, ${r.attempts} attempts` : ''}` : `${l.minutes} min`}</span>
                  <button type="button" className="btn quiet sm" onClick={() => onStart(l)}>{r ? 'Fly again' : 'Start'}</button>
                </li>
              );
            })
            : m.outline.map((t, i) => (
              <li key={t} className="outline">
                <span className="l-id">{m.n}.{i + 1}</span>
                <span className="l-title">{t}</span>
                <span className="l-state muted">planned</span>
              </li>
            ))}
        </ol>
        <p className="m-acs">ACS areas {m.acsAreas.join(', ')}</p>
      </details>
    </li>
  );
}
