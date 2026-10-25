// A lesson figure: the raw report, the runway with the wind on it, or the
// forecast laid against the flight. Every lesson figure is practice weather
// built for the lesson, and says so.

import type { Figure as FigureModel } from '../course/types';
import { parseTaf } from '../lib/taf';
import { norm } from '../lib/wind';
import { RawReport } from './MetarBlock';
import { TafTimeline } from './TafTimeline';
import { WindDiagram } from './WindDiagram';

export function Figure({ figure, practiceField }: { figure: FigureModel; practiceField: boolean }) {
  if (figure.kind === 'metar') {
    const station = figure.raw.split(' ').find((t) => /^[A-Z0-9]{4}$/.test(t) && !/^(METAR|SPECI)$/.test(t)) ?? '';
    const special = /^SPECI/.test(figure.raw);
    return (
      <figure className="fig">
        <RawReport raw={figure.raw} label={`${special ? 'SPECI' : 'METAR'} ${station}`} marks={figure.marks} />
        <figcaption>Practice weather written for this lesson{practiceField ? ', at a practice field that is not a real airport' : ''}.{figure.marks?.length ? ' Underlined groups are the ones this step is about.' : ''}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'taf') {
    const taf = parseTaf(figure.raw);
    const hours = Math.max(1, Math.round((figure.returnAt.getTime() - figure.departure.getTime()) / 3_600_000));
    return (
      <figure className="fig">
        <RawReport raw={figure.raw} label={`TAF ${taf.station}`} />
        <TafTimeline taf={taf} departure={figure.departure} tripHours={hours} />
        <figcaption>Practice forecast written for this lesson. The shaded window is your flight, departure to return.</figcaption>
      </figure>
    );
  }
  if (figure.kind !== 'wind') return null; // chart, perf, navlog and glide figures: see the course engine PR
  const { airport, windMag, speedKt, gustKt, runwayId } = figure;
  const runway = airport.runways.find((r) => r.id === runwayId) ?? airport.runways[0];
  const wind = { dirTrue: norm(windMag + airport.magneticVariationDeg) || 360, speedKt, gustKt, variable: false, rangeTrue: null };
  return (
    <figure className="fig">
      <div className="fig-wind">
        <WindDiagram airport={airport} wind={wind} rw={{ runway, windMag, steady: null, gust: null }} />
      </div>
      <figcaption>
        Runway {runway.id} with the wind drawn at {String(windMag).padStart(3, '0')}° magnetic, {speedKt} kt{gustKt ? `, gusting ${gustKt}` : ''}. Magnetic north is up.
      </figcaption>
    </figure>
  );
}
