// Flight review summary: the one sheet a pilot hands their CFI before a
// 14 CFR 61.56 review. The 61.56 window first, then what was flown module by
// module, which ACS tasks that touched, what the filed briefings kept
// flagging, and the short list to ask for. Built from saved progress and
// filed briefings only; it prints on its own.

import { dateOnly, longDate } from '../course/calendar';
import type { FiledSheet } from '../course/daily';
import { reviewSummary } from '../course/flightReview';
import { modules } from '../course/modules';
import type { CourseProgress } from '../course/progress';
import { GRADE_LABEL } from './common';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function FlightReviewSummary({ progress, log, lastFlightReview }: { progress: CourseProgress; log: FiledSheet[]; lastFlightReview: string | null }) {
  const now = new Date();
  const s = reviewSummary(progress, log, lastFlightReview, now);
  const r = s.review;
  const written = new Set(modules.filter((m) => m.lessons.length > 0).map((m) => m.n));
  const flagged = s.flaggedOnBriefings.slice(0, 5);

  return (
    <section className="card boxed frs" aria-labelledby="frs-title">
      <div className="card-head">
        <h2 id="frs-title">Flight review summary</h2>
        <span className="sub">For your CFI, before a 14 CFR 61.56 review. As of {longDate(dateOnly(now))}.</span>
        <span className="right"><button type="button" className="btn sm frs-print" onClick={() => window.print()}>Print</button></span>
      </div>

      {/* 61.56: one date drives everything, so the days left is the one loud number. */}
      <div className={`frs-status ${r ? (r.current ? 'current' : 'lapsed') : 'unset'}`}>
        {r === null ? (
          <p>No flight review date on record. Set the date of your last review on the Pilot screen and the 61.56 window shows here.</p>
        ) : (
          <>
            <span className="frs-days">
              <span className="runway">{Math.abs(r.daysLeft)}</span>
              <small>{r.current ? (r.daysLeft === 1 ? 'day left' : 'days left') : (r.daysLeft === -1 ? 'day lapsed' : 'days lapsed')}</small>
            </span>
            <p>
              <b>{r.current ? (r.daysLeft === 0 ? 'Current through today.' : `Good through ${longDate(r.dueEnd)}.`) : `Lapsed since ${longDate(r.dueEnd)}.`}</b>{' '}
              Last review {longDate(dateOnly(lastFlightReview!))}.
            </p>
          </>
        )}
      </div>

      <div className="frs-grid">
        <div className="frs-col">
          <h3>Lessons flown, {s.lessonsFlown} of {s.lessonsTotal}</h3>
          <ol className="plain frs-modules">
            {s.modules.map((m) => (
              <li key={m.n}>
                <span className="frs-n" aria-hidden="true">{m.n}</span>
                <span className="frs-mt">
                  <b>{m.title}</b>
                  <small>ACS {m.acsAreas.join(', ')}</small>
                </span>
                <span className="frs-count">{written.has(m.n) ? `${m.flown} of ${m.total}` : 'being written'}</span>
                {m.toRefly.length > 0 && (
                  <ul className="plain frs-refly" aria-label={`Lessons in ${m.title} to fly again`}>
                    {m.toRefly.map((l) => (
                      <li key={l.id}>
                        <span><span className="lid">{l.id}</span> {l.title}</span>
                        <span className={`gradechip ${l.grade}`}>{GRADE_LABEL[l.grade]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="frs-col">
          <h3>ACS tasks</h3>
          {s.tasksFlown.length === 0 ? (
            <p className="muted">Nothing flown yet. Each lesson flown adds the ACS tasks it covers here.</p>
          ) : (
            <ul className="plain refs" aria-label="ACS tasks flown">
              {s.tasksFlown.map((t) => <li key={t} className="chip acs">{t}</li>)}
            </ul>
          )}
          {s.tasksOpen.length > 0 && (
            <>
              <p className="frs-k">Still open</p>
              <ul className="plain refs" aria-label="ACS tasks still open">
                {s.tasksOpen.map((t) => <li key={t} className="chip open">{t}</li>)}
              </ul>
            </>
          )}

          <h3>Briefings filed, {s.briefings}</h3>
          {flagged.length === 0 ? (
            <p className="muted">{s.briefings === 0 ? 'None yet. Sign and file a daily flight and it counts here.' : 'Nothing has been flagged on a filed briefing.'}</p>
          ) : (
            <ul className="plain frs-flagged" aria-label="Findings flagged most">
              {flagged.map((f) => (
                <li key={f.title}><span>{f.title}</span><b>{plural(f.count, 'briefing')}</b></li>
              ))}
            </ul>
          )}

          <h3>Ask your CFI to spend time on</h3>
          {s.askFor.length === 0 ? (
            <p className="muted">Nothing to ask for from the record so far. Fly more lessons and the list builds itself.</p>
          ) : (
            <ol className="frs-ask">
              {s.askFor.map((a) => <li key={a}>{a}</li>)}
            </ol>
          )}
        </div>
      </div>

      <p className="help">Built from saved lessons and filed briefings only. Nothing here is estimated or scored.</p>
    </section>
  );
}
