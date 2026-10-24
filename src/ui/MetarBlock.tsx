// Raw METAR / TAF text with the groups that drive the decision highlighted.
// Highlighting is cosmetic; the parsed values come from lib/metar and lib/taf.

const WIND = /^(\d{3}|VRB)\d{2,3}(G\d{2,3})?(KT|MPS)$|^\d{3}V\d{3}$/;
const VIS = /SM$|^CAVOK$|^P6SM$/;
const CLOUD = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$|^SKC$|^CLR$|^NSC$/;
const TEMP = /^M?\d{2}\/(M?\d{2})?$/;
const ALT = /^[AQ]\d{4}$/;
const TIME = /^\d{6}Z$|^\d{4}\/\d{4}$|^FM\d{6}$/;
const CHANGE = /^(TEMPO|BECMG|PROB\d{2}|TAF|AMD|COR|METAR|SPECI|AUTO)$/;
const WX = /^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$|^(TS|SH)$/;

type Kind = 'w' | 'v' | 'c' | 'hl' | 'dim' | 'wx' | 'plain';

function classify(tok: string, prevIsVisInt: boolean): Kind {
  if (WIND.test(tok)) return 'w';
  if (VIS.test(tok) || prevIsVisInt) return 'v';
  if (CLOUD.test(tok)) return 'c';
  if (TEMP.test(tok) || ALT.test(tok)) return 'hl';
  if (TIME.test(tok) || CHANGE.test(tok)) return 'dim';
  if (WX.test(tok)) return 'wx';
  return 'plain';
}

export function RawReport({ raw, label, ceilingToken }: { raw: string; label: string; ceilingToken?: string | null }) {
  const [body, remarks] = raw.split(/ RMK /);
  const tokens = body.split(' ');
  return (
    <pre className="metar" aria-label={`${label} raw text`}>
      <span className="lbl">{label}</span>
      {tokens.map((t, i) => {
        // "1 1/2SM": the leading integer belongs to the visibility group.
        const nextIsFracVis = /^\d+$/.test(t) && /^\d+\/\d+SM$/.test(tokens[i + 1] ?? '');
        const kind = classify(t, nextIsFracVis);
        const isCeiling = ceilingToken && t === ceilingToken;
        const cls = isCeiling ? 'hl c' : kind === 'wx' ? 'hl' : kind === 'plain' ? '' : kind;
        return (
          <span key={i}>
            <span className={cls}>{t}</span>
            {i < tokens.length - 1 ? ' ' : ''}
          </span>
        );
      })}
      {remarks && (
        <span className="dim">
          {' RMK '}
          {remarks}
        </span>
      )}
    </pre>
  );
}

export function MetarLegend() {
  return (
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: 'var(--wx-wind)' }} />Wind, degrees true</span>
      <span><i style={{ background: 'var(--wx-vis)' }} />Visibility</span>
      <span><i style={{ background: 'var(--wx-cloud)' }} />Clouds, hundreds of ft AGL</span>
      <span><i style={{ background: 'var(--wx-hl)', border: '1px solid var(--rule)' }} />Temperature, dew point, altimeter, weather</span>
    </div>
  );
}
