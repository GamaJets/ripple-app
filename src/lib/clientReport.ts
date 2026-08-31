// The document a client hands to a physiotherapist, a doctor or a new coach.
//
// ── What was there before, and why it was not this ─────────────────────────
//
// Three things could already leave the phone, and none of them is the thing a
// professional asked for:
//
//   src/lib/gdpr.ts        every row of fourteen tables as JSON. It is a legal
//                          artefact and it is correct as one — but nobody in a
//                          clinic is going to read `"body_fat_pct": 24.1`
//                          nested three deep in a 400 kB file, and the client
//                          who opens it concludes their own data is gibberish.
//   progressDoc            the InBody scans, and only those. No tape
//                          measurements, no training, no injuries.
//   progressCsv            a spreadsheet, for a machine.
//
// So a client sitting in front of a physio with a sore shoulder had nothing to
// show them except a phone screen and their memory. This module builds the
// missing thing: one document, in their own units, saying what has been
// measured, when, by what, and how much training there is behind it.
//
// ── The three rules this file exists to keep ───────────────────────────────
//
// 1. IT NEVER INTERPRETS. Not once. This is a body-composition document, which
//    is precisely the artefact somebody would be tempted to improve with "body
//    fat is in the healthy range" or "the downward trend suggests". The app has
//    a standing rule against medical advice and this is the surface where
//    breaking it would do the most damage — the reader is a clinician, the
//    document looks official, and the client did not write a word of it. Every
//    sentence below is either a figure, the date and instrument behind a
//    figure, or a statement about what could not be read. The first→last change
//    lines are the closest it gets, and those are subtraction, printed beside
//    both endpoints and both dates, with no adjective on them.
//
// 2. IT NEVER CLAIMS TO BE COMPLETE WHEN IT IS NOT. Four independent reads feed
//    it, each with its own LoadStatus, and any of them can fail or be truncated
//    while the other three land. A document assembled from a failed read that
//    prints an empty Injuries table has told a clinician the client has
//    disclosed no injuries — which is the single most dangerous false statement
//    this app is capable of making. So the status of every section is carried
//    onto the page itself: a section that could not be read says so where the
//    table would have been, the caveats are repeated at the top under a heading
//    the reader cannot miss, and `complete` lets the screen refuse to call it a
//    full record. See src/ui/loadStatus.ts for why 'loading' is not 'ready' and
//    why 'partial' may be listed but never totalled.
//
// 3. NO PHOTOGRAPH GOES INTO IT, AND NO URL EITHER. Progress photos live in a
//    private bucket behind signed URLs that expire in an hour
//    (src/lib/progressPhotos.ts). A document is a file: it gets mailed,
//    forwarded, printed, and sits in somebody's downloads folder for years.
//    Putting a signed URL in one produces a link that leaks the object path to
//    every onward recipient and is dead by the time any of them taps it — the
//    worst of both. Putting the image itself in one hands a photograph of
//    somebody's body to whoever the file reaches next, on the strength of a tap
//    they made in a share sheet. Neither happens here; there is no code path in
//    this module that takes an image or a URL at all, and the test asserts the
//    rendered HTML contains no `<img`, no `http`, and no `file:`. If a photo is
//    ever to be handed over it must be an explicit, per-photo act in the
//    moment, the way sending one to a coach already is.
//
// Pure, framework-free and asserted against under plain `node`. Everything
// here is decided in one place because every line of it is a claim made about
// somebody's body to somebody who treats bodies.

import type { LoadStatus } from '../ui/loadStatus';
import { weightIn, lengthIn, volumeIn, convertedNote, type WeightUnit, type LengthUnit } from './units';
// The composition figures and their first→last change come from the module the
// existing progress report already uses. Shared rather than rewritten so a
// client who sends both documents cannot be shown two different accounts of the
// same six scans — which is the failure mode that made bodyFigures.ts necessary
// on the screens.
import { progressChangeLines, progressSpanLabel, figure, dayLabel, type ProgressRow } from './progressExport';

/* ── what the caller hands over ───────────────────────────────────────────── */

/**
 * One InBody (or scale) reading. Structurally satisfied by `ScanRec` from
 * src/ui/clientData.tsx, which is where the screen gets them, without this
 * module importing a provider that would drag React in with it.
 *
 * Every figure is nullable because a bathroom scale reports weight and body fat
 * and no skeletal muscle at all. A null prints as a dash; it is never a zero.
 */
export interface ReportScan {
  takenAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleKg: number | null;
  /** 'InBody (OCR)', 'InBody (manual)' — what recorded it. Optional; a scan
   *  with no stated source prints no source rather than an invented one. */
  source?: string | null;
}

/**
 * A tape-measurement column, named by the caller.
 *
 * The five parts live in src/ui/measurements.tsx as `METRICS`, and that is a
 * .tsx with React in it. Rather than copy the list here — where it would drift
 * the first time somebody adds "calf" — the caller passes the columns it is
 * already rendering, so the document and the screen cannot disagree about what
 * a client has measured.
 */
export interface ReportMeasureColumn { key: string; label: string }

/** One dated set of tape measurements, in stored centimetres. A part not
 *  measured that day is absent or null, and prints as a dash. */
export interface ReportMeasureEntry { at: string; values: Record<string, number | null | undefined> }

/**
 * One logged training day, as src/lib/clientTraining.ts computes it.
 *
 * Deliberately a narrower shape than `TrainingDay` so this module depends on
 * the fields it prints and nothing else — `TrainingDay` satisfies it
 * structurally, so `trainingBoard()` output can be handed straight in.
 */
export interface ReportTrainingDay {
  day: string;
  exercises: number;
  sets: number;
  bodyweightSets: number;
  /** Σ reps × load in kilograms, or null when nothing that day carried a load.
   *  Never 0 — a session of chin-ups and planks is not a session of no work,
   *  and printing 0 kg beside it would say it was. */
  volumeKg: number | null;
}

/**
 * The training record, narrowed from `TrainingBoard`.
 *
 * The totals are already null under anything but a whole read — that decision
 * is made in clientTraining.ts and is not re-made here. This module's job is to
 * print a dash where a total is null and to say why on the page.
 */
export interface ReportTraining {
  state: 'unreadable' | 'none' | 'some';
  dayCount: number | null;
  entryCount: number | null;
  sets: number | null;
  volumeKg: number | null;
  newestDay: string | null;
  days: readonly ReportTrainingDay[];
  /**
   * How many logging events carry a timestamp that could not be read, and so
   * belong to no day.
   *
   * `TrainingBoard.undated` holds them; the caller passes its length. They are
   * counted in the totals above — the sets and the load in them are real — and
   * they cannot appear in the day table, because filing them under a day would
   * invent a day nobody trained on. So the document states the number rather
   * than letting the table and the totals silently disagree.
   *
   * It also decides a case the day count alone gets wrong: a record whose every
   * session is undated has `days: []` and is NOT an empty training history.
   */
  undatedCount: number;
}

/** One injury the client has disclosed, already labelled by the caller through
 *  `areaLabel()` so this module needs no copy of INJURY_AREAS. */
export interface ReportInjury {
  label: string;
  severity: string;
  status: string;
  note?: string | null;
  /** When it was disclosed in the app — NOT when it happened, which nothing
   *  asks for and nothing stores. The column is headed accordingly. */
  at: string;
}

/** A section and the honesty of the read behind it. */
export interface ReportSection<T> { status: LoadStatus; items: T }

export interface ClientReportInput {
  name: string;
  brand: string;
  /** `YYYY-MM-DD`, supplied by the caller (todayISO()) rather than taken from
   *  the clock in here, so the document is a pure function of its inputs and
   *  the suite can assert on a fixed date. */
  generatedOn: string;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  composition: ReportSection<ReportScan[]>;
  measurements: ReportSection<ReportMeasureEntry[]>;
  measureColumns: ReportMeasureColumn[];
  training: ReportSection<ReportTraining>;
  injuries: ReportSection<ReportInjury[]>;
}

export interface ClientReportDoc {
  html: string;
  text: string;
  /** True only when all four reads were whole. The screen uses it to word the
   *  share sheet — a partial record must not be offered as "your full record". */
  complete: boolean;
  /** One sentence per section that could not be read or came back truncated.
   *  Empty when `complete`. These are printed ON the document as well as being
   *  returned, because the caveat has to travel with the file. */
  caveats: string[];
}

/* ── the standing statements ──────────────────────────────────────────────── */

/**
 * What the document is, said on the document.
 *
 * A clinician who is handed a printout with a logo on it will reasonably assume
 * it came from an instrument or a clinical system. It did not: these are
 * readings a person transcribed off a body-composition machine's printout, tape
 * measurements they took themselves, and training they logged. Where a figure
 * came from decides how much weight it can carry, and the reader can only judge
 * that if they are told.
 */
export const REPORT_PROVENANCE = [
  'These are the figures held in this app for the person named above, printed at their request and by their own action.',
  'Body-composition figures are transcribed from body-composition machine printouts — read automatically from a photograph of the printout, or typed in by hand — and are not measured by this app. Tape measurements and training are logged by the person themselves.',
  'Dates are the dates recorded against each entry. Where a figure was not recorded it is shown as a dash, never as a zero.',
];

/**
 * What the document is not.
 *
 * Kept as a constant so it cannot be edited into something softer on one screen
 * and left alone on another, and so the test can assert it is present in every
 * document this module builds — including an empty one.
 */
export const REPORT_LIMITS =
  'This document contains no assessment, no interpretation and no advice. It is a record of measurements and logged activity only. Nothing in it has been reviewed by a clinician, and no figure in it should be read as a diagnosis or as a substitute for professional judgement.';

/** Said on the document because the absence is itself information: a reader
 *  who is not told will not know that progress photographs exist at all, and
 *  the client who sent this should not have to remember that they did not. */
export const REPORT_NO_PHOTOS =
  'No photographs are included. Progress photographs are stored privately to this account and are never attached to a document; they can only be shared one at a time, deliberately, from the app. Documents uploaded about an injury are likewise not included — only the injury the person recorded from them.';

/* ── read honesty ─────────────────────────────────────────────────────────── */

export type ReportSectionState = 'whole' | 'partial' | 'unreadable';

/**
 * What may be said about a section, from the status of the read behind it.
 *
 * 'loading' collapses into 'unreadable' and that is the load-bearing line. A
 * document is built and handed over in one gesture — there is no later moment
 * at which a section that was still in flight gets filled in — so a read that
 * has not landed is, for this file's purposes, a read that did not answer.
 * Treating it as 'whole' would print an empty Injuries table for anybody who
 * tapped Share while the screen was still opening.
 */
export function sectionState(status: LoadStatus): ReportSectionState {
  if (status === 'ready') return 'whole';
  if (status === 'partial') return 'partial';
  return 'unreadable';
}

/** Whether this section's figures may be totalled, counted or compared
 *  end-to-end. Only a whole read may — see src/ui/loadStatus.ts. */
export const countable = (status: LoadStatus): boolean => sectionState(status) === 'whole';

/**
 * The sentence a section that is not whole puts on the page.
 *
 * Named per section rather than one generic banner, because "we could not read
 * your injuries" and "we could not read your tape measurements" are wildly
 * different things for a physiotherapist to be missing, and a reader who is
 * told only that "some data is unavailable" will assume it was the unimportant
 * kind.
 */
export function sectionCaveat(what: string, status: LoadStatus): string | null {
  const st = sectionState(status);
  if (st === 'whole') return null;
  if (st === 'partial') {
    return `${what}: more entries exist than could be read in one request. What is listed is real, and it is not all of it — no total or overall change is stated for this section.`;
  }
  return `${what}: could not be read when this document was made. This section is EMPTY BECAUSE OF A FAILED READ, not because there is nothing on record. Do not read it as "none".`;
}

/**
 * Every caveat this document has to carry, in the order the sections appear.
 *
 * Empty means, and may be taken to mean, that all four reads landed whole.
 */
export function reportCaveats(input: ClientReportInput): string[] {
  return [
    sectionCaveat('Body composition', input.composition.status),
    sectionCaveat('Tape measurements', input.measurements.status),
    sectionCaveat('Training', input.training.status),
    sectionCaveat('Injuries disclosed', input.injuries.status),
  ].filter((s): s is string => s !== null);
}

/* ── plumbing ─────────────────────────────────────────────────────────────── */

/**
 * Text into HTML.
 *
 * Not decoration. A client's own name, an injury note they typed, and an
 * exercise name out of the catalogue all land inside this document's markup. A
 * note reading "pain < 4/10 on press" would truncate the page from that
 * character onward in some renderers and swallow the rest of the injury list in
 * others — silently, in the one document where a missing injury matters most.
 * Ampersands are the everyday case: "R&D" and "S&C coach" both appear in names.
 */
export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A count or a total with a thousands separator, or a dash when there is no
 *  figure to print. A tonnage runs to five and six digits. */
const num = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString();

/**
 * A figure and its unit, or a bare dash.
 *
 * The unit does not survive a missing reading. "— lb" and "— muscle" are what
 * naive concatenation produces, and a unit attached to nothing reads as a
 * measurement whose value failed to print rather than as one that was never
 * taken. The HTML tables put the unit in the column heading and so never hit
 * this; the plain-text mirror has no headings and does.
 */
const unitised = (text: string, unit: string): string => (text === '—' ? '—' : `${text} ${unit}`);

/**
 * Said inside a truncated section as well as in the banner at the top.
 *
 * The banner is what a reader sees first and `caveats` is the record of it, but
 * somebody who scrolls straight to the tape measurements and starts counting
 * entries needs the sentence next to the thing they are counting.
 */
const partialNote = (what: string): string =>
  `Not all of this person’s ${what} could be read in one request. What is listed is real; it is not all of it.`;

/** Oldest first. A record of a body over time is read forward, and the change
 *  lines under the table are first-to-latest. */
function oldestFirst<T>(items: readonly T[], at: (x: T) => string): T[] {
  return [...items].sort((a, b) => {
    const d = Date.parse(at(a)) - Date.parse(at(b));
    // Timestamps that will not parse keep their relative order rather than
    // being shuffled by a NaN comparison, which sorts unpredictably.
    return Number.isFinite(d) ? d : 0;
  });
}

/** The scans as the shared progress builders want them. */
export function toProgressRows(scans: readonly ReportScan[]): ProgressRow[] {
  return oldestFirst(scans, (s) => s.takenAt).map((s) => ({
    date: String(s.takenAt).slice(0, 10),
    weightKg: Number.isFinite(s.weightKg as number) ? (s.weightKg as number) : null,
    bodyFatPct: Number.isFinite(s.bodyFatPct as number) ? (s.bodyFatPct as number) : null,
    muscleKg: Number.isFinite(s.muscleKg as number) ? (s.muscleKg as number) : null,
  }));
}

/**
 * How many training days the table lists.
 *
 * A client three years in has several hundred, and a document nobody can page
 * through is a document nobody reads. The totals above the table cover
 * everything that was read; the table itself says which slice of it is printed,
 * so a reader counting the rows cannot mistake them for the whole record.
 */
export const TRAINING_DAYS_SHOWN = 30;

/* ── the document ─────────────────────────────────────────────────────────── */

const STYLE = `
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:26px;margin:0;font-size:14px;line-height:1.45}
  .h{background:#0f172a;color:#fff;padding:18px 22px;border-radius:14px}
  .h h1{margin:0;font-size:21px} .h p{margin:4px 0 0;opacity:.85;font-size:12px}
  h2{font-size:15px;margin:26px 0 6px;padding-bottom:5px;border-bottom:2px solid #0f172a}
  p{margin:6px 0}
  .lede{color:#475569;font-size:12px}
  .warn{border:2px solid #b45309;border-radius:10px;padding:12px 14px;margin-top:16px}
  .warn h3{margin:0 0 6px;font-size:13px;color:#b45309;text-transform:uppercase;letter-spacing:.5px}
  .warn li{margin-bottom:5px}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .r{text-align:right}
  .none{color:#64748b}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px}
`;

/** A section that could not be read renders THIS where its table would be. An
 *  empty table with a footnote is not enough: the footnote is below the thing
 *  the reader has already believed. */
const unreadableBlock = (what: string): string =>
  `<p class="none"><b>Not read.</b> ${escapeHtml(what)} could not be read from the server when this document was made, so nothing is listed here. This is not a statement that there is none on record.</p>`;

const emptyBlock = (what: string): string =>
  `<p class="none">${escapeHtml(what)}</p>`;

/**
 * The whole document, in HTML and in plain text.
 *
 * Both are built from the same values in the same order so the fallback a
 * client sends when a PDF cannot be produced says exactly what the PDF would
 * have said — including every caveat. A text fallback that quietly dropped the
 * "could not be read" lines would be the same failure this module is against,
 * arriving through the back door.
 */
export function clientReportDoc(input: ClientReportInput): ClientReportDoc {
  const caveats = reportCaveats(input);
  const complete = caveats.length === 0;
  const wu = input.weightUnit;
  const lu = input.lengthUnit;
  const who = (input.name || '').trim() || 'This client';
  const brand = input.brand || 'Repple';

  const H: string[] = [];
  const T: string[] = [];

  /* ── heading ───────────────────────────────────────────────────────────── */
  H.push(`<div class="h"><h1>Health &amp; training summary</h1><p>${escapeHtml(who)} · prepared ${escapeHtml(dayLabel(input.generatedOn))} · ${escapeHtml(brand)}</p></div>`);
  T.push(`${who} — health & training summary`);
  T.push(`Prepared ${dayLabel(input.generatedOn)} · ${brand}`);

  /* ── what this is, and is not ──────────────────────────────────────────── */
  H.push('<h2>About this document</h2>');
  T.push('', 'ABOUT THIS DOCUMENT');
  for (const line of REPORT_PROVENANCE) { H.push(`<p class="lede">${escapeHtml(line)}</p>`); T.push(line); }
  H.push(`<p class="lede">${escapeHtml(REPORT_LIMITS)}</p>`);
  T.push(REPORT_LIMITS);
  H.push(`<p class="lede">${escapeHtml(REPORT_NO_PHOTOS)}</p>`);
  T.push(REPORT_NO_PHOTOS);

  /* ── the caveats, at the top, where they cannot be scrolled past ───────── */
  if (!complete) {
    H.push('<div class="warn"><h3>This record is incomplete</h3><ul>');
    T.push('', '*** THIS RECORD IS INCOMPLETE ***');
    for (const c of caveats) { H.push(`<li>${escapeHtml(c)}</li>`); T.push('- ' + c); }
    H.push('</ul></div>');
  }

  /* ── body composition ──────────────────────────────────────────────────── */
  //
  // The unit is the client's own. `convertedNote` is printed with the table for
  // the reason it exists: the person's machine printout says 81.6 kg and this
  // says 180 lb, and without a line saying which was measured the clinician has
  // two readings that disagree rather than one said twice.
  {
    const st = sectionState(input.composition.status);
    const scans = oldestFirst(input.composition.items, (s) => s.takenAt);
    const rows = toProgressRows(scans);
    H.push('<h2>Body composition</h2>');
    T.push('', 'BODY COMPOSITION');
    if (st === 'unreadable') {
      H.push(unreadableBlock('Body-composition scans'));
      T.push('Not read — body-composition scans could not be read. This is not a statement that there are none.');
    } else if (!scans.length) {
      H.push(emptyBlock('No body-composition scans are recorded.'));
      T.push('No body-composition scans are recorded.');
    } else {
      const span = `${progressSpanLabel(rows)}.`;
      H.push(`<p class="lede">${escapeHtml(span)}</p>`);
      T.push(span);
      const conv = convertedNote(wu);
      if (conv) { H.push(`<p class="lede">${escapeHtml(conv)}</p>`); T.push(conv); }
      const body = scans.map((s, i) => {
        const r = rows[i];
        return `<tr><td>${escapeHtml(dayLabel(r.date))}</td>`
          + `<td class="r">${escapeHtml(figure(weightIn(r.weightKg, wu)))}</td>`
          + `<td class="r">${escapeHtml(figure(r.bodyFatPct))}</td>`
          + `<td class="r">${escapeHtml(figure(weightIn(r.muscleKg, wu)))}</td>`
          + `<td>${escapeHtml(s.source || '—')}</td></tr>`;
      }).join('');
      H.push(`<table><tr><th>Date</th><th class="r">Weight (${escapeHtml(wu)})</th><th class="r">Body fat (%)</th><th class="r">Muscle (${escapeHtml(wu)})</th><th>Recorded from</th></tr>${body}</table>`);
      for (const [i, r] of rows.entries()) {
        T.push(`  ${dayLabel(r.date)}  ${figure(weightIn(r.weightKg, wu), ' ' + wu)}  ${figure(r.bodyFatPct, '%')}  ${unitised(figure(weightIn(r.muscleKg, wu), ' ' + wu), 'muscle')}  (${scans[i].source || 'source not recorded'})`);
      }
      // The change is subtraction between two readings that both exist, printed
      // with both endpoints. It is stated only over a WHOLE read: a truncated
      // set is a prefix of an unknown whole, so its "first" reading is not the
      // person's first and the change across it is a change between two
      // arbitrary points presented as a span of their record.
      if (st === 'whole') {
        const lines = progressChangeLines(rows, wu);
        if (lines.length) {
          H.push(`<p>First reading to latest: ${escapeHtml(lines.join(' · '))}</p>`);
          T.push('First reading to latest: ' + lines.join(' · '));
        } else {
          H.push('<p class="lede">One reading of each figure so far — a change needs two.</p>');
          T.push('One reading of each figure so far — a change needs two.');
        }
      } else {
        H.push('<p class="lede">No overall change is stated: not all of this person’s scans could be read, so the earliest one listed may not be their first.</p>');
        T.push('No overall change is stated: not all scans could be read.');
      }
    }
  }

  /* ── tape measurements ─────────────────────────────────────────────────── */
  {
    const st = sectionState(input.measurements.status);
    const entries = oldestFirst(input.measurements.items, (e) => e.at);
    const cols = input.measureColumns;
    H.push('<h2>Tape measurements</h2>');
    T.push('', 'TAPE MEASUREMENTS');
    if (st === 'unreadable') {
      H.push(unreadableBlock('Tape measurements'));
      T.push('Not read — tape measurements could not be read. This is not a statement that there are none.');
    } else if (!entries.length || !cols.length) {
      H.push(emptyBlock('No tape measurements are recorded.'));
      T.push('No tape measurements are recorded.');
    } else {
      if (st === 'partial') {
        const p = partialNote('tape measurements');
        H.push(`<p class="lede"><b>${escapeHtml(p)}</b></p>`);
        T.push(p);
      }
      const conv = convertedNote(lu);
      if (conv) { H.push(`<p class="lede">${escapeHtml(conv)}</p>`); T.push(conv); }
      const head = cols.map((c) => `<th class="r">${escapeHtml(c.label)} (${escapeHtml(lu)})</th>`).join('');
      const body = entries.map((e) => {
        const cells = cols.map((c) => `<td class="r">${escapeHtml(figure(lengthIn(e.values[c.key] ?? null, lu)))}</td>`).join('');
        return `<tr><td>${escapeHtml(dayLabel(String(e.at).slice(0, 10)))}</td>${cells}</tr>`;
      }).join('');
      H.push(`<table><tr><th>Date</th>${head}</tr>${body}</table>`);
      for (const e of entries) {
        T.push(`  ${dayLabel(String(e.at).slice(0, 10))}  ` + cols.map((c) => `${c.label} ${figure(lengthIn(e.values[c.key] ?? null, lu), ' ' + lu)}`).join('  '));
      }
    }
  }

  /* ── training ──────────────────────────────────────────────────────────── */
  //
  // Every total here is null unless the read was whole — that is decided in
  // clientTraining.ts and honoured, not re-decided. A tonnage is also null when
  // the read WAS whole and nothing carried a load, which is a bodyweight
  // history rather than an easy one; the bodyweight-set column is printed
  // beside it so the reader can see which of the two they are looking at.
  {
    const st = sectionState(input.training.status);
    const b = input.training.items;
    H.push('<h2>Training logged</h2>');
    T.push('', 'TRAINING LOGGED');
    if (st === 'unreadable' || b.state === 'unreadable') {
      H.push(unreadableBlock('Logged training'));
      T.push('Not read — logged training could not be read. This is not a statement that none was logged.');
    } else if (!b.days.length && b.undatedCount < 1) {
      // Nothing dated AND nothing undated. Only then is the record empty — a
      // history whose every session carries an unreadable timestamp has no days
      // to list and is not an empty history, and saying so would tell a
      // clinician this person has never trained.
      H.push(emptyBlock('No training sessions are logged in this app.'));
      T.push('No training sessions are logged in this app.');
    } else {
      if (st === 'partial') {
        const p = partialNote('logged training');
        H.push(`<p class="lede"><b>${escapeHtml(p)}</b></p>`);
        T.push(p);
      }
      const tonnage = volumeIn(b.volumeKg, wu);
      const totals: [string, string][] = [
        ['Days trained', num(b.dayCount)],
        ['Separate logging events', num(b.entryCount)],
        ['Sets recorded', num(b.sets)],
        [`Total load moved (${wu})`, num(tonnage)],
        ['Most recent day', b.newestDay ? dayLabel(b.newestDay) : '—'],
      ];
      H.push(`<table>${totals.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="r">${escapeHtml(v)}</td></tr>`).join('')}</table>`);
      for (const [k, v] of totals) T.push(`  ${k}: ${v}`);
      H.push(`<p class="lede">${escapeHtml('Load moved is the sum of repetitions × weight over the sets that carried a weight. Sets done against bodyweight alone carry no load to total and are counted separately below, so a low figure here is not a light history.')}</p>`);
      T.push('Load moved is the sum of repetitions x weight over the sets that carried a weight; bodyweight sets carry no load to total.');

      if (b.undatedCount > 0) {
        const u = `${num(b.undatedCount)} logging event${b.undatedCount === 1 ? '' : 's'} carr${b.undatedCount === 1 ? 'ies' : 'y'} a timestamp that could not be read, so ${b.undatedCount === 1 ? 'it does' : 'they do'} not appear in the table of days below. The sets and load in ${b.undatedCount === 1 ? 'it are' : 'them are'} counted in the figures above.`;
        H.push(`<p class="lede">${escapeHtml(u)}</p>`);
        T.push(u);
      }
      const shown = b.days.slice(0, TRAINING_DAYS_SHOWN);
      if (!shown.length) {
        // Reachable only through the undated branch above: sessions exist and
        // not one of them has a date this can put a row under.
        const noneDated = 'No logged session carries a readable date, so there is no day-by-day table.';
        H.push(`<p class="none">${escapeHtml(noneDated)}</p>`);
        T.push(noneDated);
      } else {
        const slice = shown.length < b.days.length
          ? `The ${shown.length} most recent of the ${b.days.length} days read are listed. The figures above cover all of them.`
          : `All ${b.days.length} logged days are listed.`;
        H.push(`<p class="lede">${escapeHtml(slice)}</p>`);
        T.push(slice);
        const body = shown.map((d) => `<tr><td>${escapeHtml(dayLabel(d.day))}</td>`
          + `<td class="r">${escapeHtml(num(d.exercises))}</td>`
          + `<td class="r">${escapeHtml(num(d.sets))}</td>`
          + `<td class="r">${escapeHtml(num(d.bodyweightSets))}</td>`
          + `<td class="r">${escapeHtml(num(volumeIn(d.volumeKg, wu)))}</td></tr>`).join('');
        H.push(`<table><tr><th>Date</th><th class="r">Exercises</th><th class="r">Sets</th><th class="r">Of those, bodyweight</th><th class="r">Load moved (${escapeHtml(wu)})</th></tr>${body}</table>`);
        for (const d of shown) T.push(`  ${dayLabel(d.day)}  ${num(d.exercises)} exercises  ${num(d.sets)} sets (${num(d.bodyweightSets)} bodyweight)  ${unitised(num(volumeIn(d.volumeKg, wu)), wu)}`);
      }
    }
  }

  /* ── injuries disclosed ────────────────────────────────────────────────── */
  //
  // The section a physiotherapist opens the document for, and the one where an
  // empty table produced by a failed read would be actively dangerous. Hence
  // the unreadable branch above it and the caveat repeated at the top.
  {
    const st = sectionState(input.injuries.status);
    const items = oldestFirst(input.injuries.items, (i) => i.at);
    H.push('<h2>Injuries disclosed in the app</h2>');
    T.push('', 'INJURIES DISCLOSED IN THE APP');
    if (st === 'unreadable') {
      H.push(unreadableBlock('Disclosed injuries'));
      T.push('Not read — disclosed injuries could not be read. THIS IS NOT A STATEMENT THAT NONE WERE DISCLOSED.');
    } else if (!items.length) {
      H.push(emptyBlock('No injuries have been recorded in the app. This records only what has been entered here, and is not a medical history.'));
      T.push('No injuries have been recorded in the app. This records only what has been entered here, and is not a medical history.');
    } else {
      if (st === 'partial') {
        const p = partialNote('disclosed injuries');
        H.push(`<p class="lede"><b>${escapeHtml(p)}</b></p>`);
        T.push(p);
      }
      const body = items.map((i) => `<tr><td>${escapeHtml(i.label)}</td>`
        + `<td>${escapeHtml(i.severity)}</td>`
        + `<td>${escapeHtml(i.status)}</td>`
        + `<td>${escapeHtml(dayLabel(String(i.at).slice(0, 10)))}</td>`
        + `<td>${escapeHtml(i.note || '—')}</td></tr>`).join('');
      H.push(`<table><tr><th>Area</th><th>Severity as recorded</th><th>State</th><th>Recorded on</th><th>Their note</th></tr>${body}</table>`);
      for (const i of items) T.push(`  ${i.label} — ${i.severity}, ${i.status}, recorded ${dayLabel(String(i.at).slice(0, 10))}${i.note ? ' — "' + i.note + '"' : ''}`);
      H.push('<p class="lede">Severity and state are as the person recorded them, in the app’s own three-step wording. They are not a clinical grading.</p>');
      T.push('Severity and state are as the person recorded them; they are not a clinical grading.');
    }
  }

  /* ── foot ──────────────────────────────────────────────────────────────── */
  const foot = complete
    ? `Every section of this document was read successfully on ${dayLabel(input.generatedOn)}. Generated by ${brand}.`
    : `PARTS OF THIS DOCUMENT COULD NOT BE READ — see "This record is incomplete" above. Generated by ${brand}.`;
  H.push(`<p class="foot">${escapeHtml(foot)}</p>`);
  T.push('', foot);

  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body>${H.join('')}</body></html>`;
  return { html, text: T.join('\n'), complete, caveats };
}

/**
 * The sentence the share sheet says before anything leaves the phone.
 *
 * A client about to hand a document to a clinician is entitled to know, in
 * advance, that a section of it is missing — afterwards is too late, because
 * the file is already in somebody else's inbox.
 */
export function reportShareBlurb(doc: ClientReportDoc): string {
  const base = 'A one-page summary of your body-composition scans, tape measurements, logged training and any injuries you have recorded. No photographs are included, and it contains no assessment or advice of any kind.';
  if (doc.complete) return base;
  return base + '\n\nBEFORE YOU SEND IT: ' + doc.caveats.length + ' part'
    + (doc.caveats.length === 1 ? '' : 's')
    + ' of your record could not be read just now, so the document says so on its own front page rather than looking complete. You can send it as it is, or close this and try again in a moment.';
}
