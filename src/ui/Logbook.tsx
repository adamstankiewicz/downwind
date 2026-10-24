// Logbook: lessons flown, briefings filed, and where you stand against the
// ACS review items. The record a CFI can read before a flight review.

import { lessonById } from '../course/modules';
import type { CourseProgress } from '../course/progress';
import type { FiledSheet } from '../course/daily';
import { GRADE_LABEL } from './common';
import { Readiness } from './Readiness';

const CHOICE_LABEL: Record<FiledSheet['choice'], string> = { go: 'Go', 'go-plan': 'Go with a plan', delay: 'Delay', cancel: 'Cancel' };

export function Logbook({ progress, log, epoch, goReview, goCourse }: { progress: CourseProgress; log: FiledSheet[]; epoch: number; goReview: () => void; goCourse: () => void }) {
  const flown = Object.entries(progress).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt));
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const fmtZ = (iso: string) => { const d = new Date(iso); return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`; };

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>Logbook</h1>
            <span className="muted">{flown.length} lesson{flown.length === 1 ? '' : 's'} flown, {log.length} briefing{log.length === 1 ? '' : 's'} filed.</span>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Lessons flown</h2></div>
          {flown.length === 0 ? (
            <div className="empty">
              <p>Nothing flown yet. The first lesson is waiting on the course page.</p>
              <button type="button" className="btn primary" onClick={goCourse}>Open the course</button>
            </div>
          ) : (
            <ol className="log">
              {flown.map(([id, r]) => {
                const l = lessonById(id);
                return (
                  <li key={id}>
                    <span className="z">{fmtDate(r.lastAt)}</span>
                    <span className="what"><b>{id} {l?.title ?? 'Lesson'}</b><small>{r.attempts} attempt{r.attempts === 1 ? '' : 's'}, best {GRADE_LABEL[r.bestGrade].toLowerCase()}, {r.lcg}{r.confidentlyWrong ? ', confidently wrong last time' : ''}</small></span>
                    <span className={`g ${r.lastGrade}`}>{GRADE_LABEL[r.lastGrade]}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Briefings filed</h2></div>
          {log.length === 0 ? (
            <p className="muted">Sign and file a daily flight and it is recorded here: the call, the grade, how many lines you read right.</p>
          ) : (
            <ol className="log">
              {log.map((s) => (
                <li key={s.id}>
                  <span className="z">{fmtDate(s.filedAt)}<br />{fmtZ(s.filedAt)}</span>
                  <span className="what">
                    <b>{s.station}, {CHOICE_LABEL[s.choice]} at {s.confidence}% sure</b>
                    <small>
                      {s.source === 'sample' ? 'Practice weather. ' : ''}
                      {s.readingsTotal ? `${s.readingsRight} of ${s.readingsTotal} readings matched. ` : 'No lines asked. '}
                      {s.findings.filter((f) => f.severity !== 'info').length ? `Flagged: ${s.findings.filter((f) => f.severity !== 'info').map((f) => f.title.toLowerCase()).join('; ')}.` : 'Nothing flagged.'}
                      {s.confidentlyWrong ? ' Confidently wrong.' : ''}
                    </small>
                  </span>
                  <span className={`g ${s.grade}`}>{GRADE_LABEL[s.grade]}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <Readiness key={epoch} goReview={goReview} embedded />
    </>
  );
}
