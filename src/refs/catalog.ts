// FAA handbooks the course cites, as the PDF files the FAA publishes. These are
// US government works and in the public domain. Each entry is pinned to an
// edition; when the FAA revises a book, update the entry and re-check the
// passages with `npm run check-docs`.
//
// The app never fetches faa.gov directly (no CORS, and offline needs a copy on
// our own origin). It asks for /api/docs/<id>; the edge worker and the dev
// server map that to `path` on www.faa.gov.

export interface DocSource {
  id: string;
  /** Short name used on chips and in the viewer header. */
  short: string;
  title: string;
  edition: string;
  /** Chapter title, when the file is one chapter of a book. */
  chapter?: string;
  /** Path of the PDF on www.faa.gov. */
  path: string;
  /** The FAA page that lists the book, for "open at the FAA". */
  landing: string;
}

const PHAK_LANDING = 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak';
const AFH_LANDING = 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook';
const AFH_FILES = '/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook';

const phak = (n: number, chapter: string): DocSource => ({
  id: `phak-${n}`,
  short: `PHAK ch. ${n}`,
  title: "Pilot's Handbook of Aeronautical Knowledge",
  edition: 'FAA-H-8083-25C',
  chapter: `Chapter ${n}: ${chapter}`,
  // The FAA numbers chapter files two ahead of the chapter (front matter and contents come first).
  path: `/sites/faa.gov/files/${String(n + 2).padStart(2, '0')}_phak_ch${n}.pdf`,
  landing: PHAK_LANDING,
});

const afh = (n: number, chapter: string): DocSource => ({
  id: `afh-${n}`,
  short: `AFH ch. ${n}`,
  title: 'Airplane Flying Handbook',
  edition: 'FAA-H-8083-3C',
  chapter: `Chapter ${n}: ${chapter}`,
  path: `${AFH_FILES}/${String(n + 1).padStart(2, '0')}_afh_ch${n}.pdf`,
  landing: AFH_LANDING,
});

export const DOCS: Record<string, DocSource> = Object.fromEntries(
  [
    phak(2, 'Aeronautical Decision-Making'),
    phak(4, 'Principles of Flight'),
    phak(5, 'Aerodynamics of Flight'),
    phak(7, 'Aircraft Systems'),
    phak(8, 'Flight Instruments'),
    phak(9, 'Flight Manuals and Other Documents'),
    phak(10, 'Weight and Balance'),
    phak(11, 'Aircraft Performance'),
    phak(12, 'Weather Theory'),
    phak(13, 'Aviation Weather Services'),
    phak(15, 'Airspace'),
    phak(16, 'Navigation'),
    phak(17, 'Aeromedical Factors'),
    afh(5, 'Maintaining Aircraft Control: Upset Prevention and Recovery Training'),
    afh(6, 'Takeoffs and Departure Climbs'),
    afh(9, 'Approaches and Landings'),
    afh(18, 'Emergency Procedures'),
    {
      id: 'awh',
      short: 'Aviation Weather Handbook',
      title: 'Aviation Weather Handbook',
      edition: 'FAA-H-8083-28B',
      path: '/sites/faa.gov/files/FAA-H-8083-28B.pdf',
      landing: 'https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/faa-h-8083-28-aviation-weather-handbook',
    },
    {
      id: 'rmh',
      short: 'Risk Management Handbook',
      title: 'Risk Management Handbook',
      edition: 'FAA-H-8083-2A',
      path: '/sites/faa.gov/files/2022-06/risk_management_handbook_2A.pdf',
      landing: 'https://www.faa.gov/regulationspolicies/handbooksmanuals/risk-management-handbook-faa-h-8083-2a',
    },
  ].map((d) => [d.id, d]),
);

export const docUrl = (id: string) => `/api/docs/${id}`;
