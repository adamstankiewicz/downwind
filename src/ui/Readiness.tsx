// Readiness: mastery per ACS Area I task, plus the confidently-wrong rate.

import { masteryByTask } from '../review/scheduler';
import { reviewItems } from '../review/items';
import { Card, PageHead } from './common';
import { EmptyGlyph } from './Review';

export const TASK_NAMES: Record<string, string> = {
  'PA.I.A': 'Pilot Qualifications',
  'PA.I.B': 'Airworthiness Requirements',
  'PA.I.C': 'Weather Information',
  'PA.I.D': 'Cross-Country Flight Planning',
  'PA.I.E': 'National Airspace System',
  'PA.I.F': 'Performance and Limitations',
  'PA.I.G': 'Operation of Systems',
  'PA.I.H': 'Human Factors',
};

export function Readiness({ goReview }: { goReview: () => void }) {
  const mastery = masteryByTask();
  const byAcs = new Map(mastery.map((m) => [m.acs, m]));
  const tasks = Object.keys(TASK_NAMES);
  const itemCounts = new Map<string, number>();
  for (const i of reviewItems) itemCounts.set(i.acs, (itemCounts.get(i.acs) ?? 0) + 1);

  const answered = mastery.reduce((n, m) => n + m.answered, 0);
  const weighted = answered ? mastery.reduce((n, m) => n + m.correctRate * m.answered, 0) / answered : 0;
  const cwTasks = mastery.filter((m) => m.answered > 0);
  const cwRate = cwTasks.length ? cwTasks.reduce((n, m) => n + m.confidentlyWrongRate * m.answered, 0) / cwTasks.reduce((n, m) => n + m.answered, 0) : 0;

  return (
    <>
      <PageHead
        title="Readiness"
        lead="Where you stand against the Private Pilot ACS, Area I. Recent answers weigh more than old ones."
        meta={<>Standard <b>FAA-S-ACS-6C</b></>}
      />
      {answered === 0 ? (
        <div className="empty">
          <EmptyGlyph />
          <h2>No data yet</h2>
          <p>Readiness fills in as you answer review items and make go/no-go decisions. Eight Area I tasks are tracked; each needs a few answers before the bar means anything.</p>
          <button type="button" className="btn primary" onClick={goReview}>Start a review session</button>
        </div>
      ) : (
        <div className="grid-2">
          <Card title="By ACS task" sub={`${answered} answer${answered === 1 ? '' : 's'}`}>
            <div className="ready">
              {tasks.map((acs) => {
                const m = byAcs.get(acs);
                const pct = m ? Math.round(m.correctRate * 100) : null;
                const cls = pct === null ? 'none' : pct >= 80 ? 'hi' : pct >= 60 ? '' : 'lo';
                return (
                  <div className="ready-row" key={acs}>
                    <div className="name">
                      <span>{TASK_NAMES[acs]}</span>
                      <small>{acs}, {m ? `${m.answered} answered` : `${itemCounts.get(acs) ?? 0} item${(itemCounts.get(acs) ?? 0) === 1 ? '' : 's'}, none answered`}</small>
                    </div>
                    <div className="bar" role="img" aria-label={pct === null ? `${TASK_NAMES[acs]}: no data` : `${TASK_NAMES[acs]}: ${pct} percent`}>
                      <i className={cls} style={{ width: pct === null ? '0%' : `${pct}%` }} />
                    </div>
                    <span className="pct">{pct === null ? '—' : `${pct}%`}</span>
                  </div>
                );
              })}
            </div>
            <p className="help">Green is 80% and up, blue 60 to 79, amber below. Tasks without items yet (Operation of Systems) fill in with later content.</p>
          </Card>
          <div className="stack">
            <Card title="Calibration">
              <div className="score-row">
                <div className="stat"><span className="k">Weighted correct</span><span className="v">{Math.round(weighted * 100)}%</span></div>
                <div className="stat"><span className="k">Confidently wrong</span><span className={`v ${cwRate > 0.2 ? 'warn' : ''}`}>{Math.round(cwRate * 100)}%</span></div>
              </div>
              <p className="help">
                Confidently wrong is the share of missed answers given at 70% confidence or higher. A high number means you don't know what you don't know, which is the dangerous kind of gap. A low number with a low score just means you need more reps.
              </p>
            </Card>
            <Card title="Weakest tasks">
              {mastery.length === 0 ? (
                <p className="muted">Nothing yet.</p>
              ) : (
                <ul className="plain weak">
                  {[...mastery].sort((a, b) => a.correctRate - b.correctRate).slice(0, 3).map((m) => (
                    <li key={m.acs}>
                      <span>{TASK_NAMES[m.acs] ?? m.acs} <span className="chip acs">{m.acs}</span></span>
                      <b>{Math.round(m.correctRate * 100)}%</b>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn" onClick={goReview}>Review now</button>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
