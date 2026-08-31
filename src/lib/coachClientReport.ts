// The document a coach hands over at the end of a block.
//
// ── What was there before, and why it was not this ─────────────────────────
//
// A CLIENT can now produce a handover document about themselves
// (src/lib/clientReport.ts, and read its header before this one). A COACH could
// produce nothing about a client at all — which is the thing a working coach
// actually sends: at the end of twelve weeks, when somebody moves city, when a
// client asks "what did we actually do?", or when they go to another coach and
// that coach asks what has already been tried.
//
// What existed instead was four screens the coach could read (client-body,
// client-training, client-goals, client-week) and no way to get any of it off
// the phone. So the end of a block produced either nothing, or a message the
// coach typed from memory — which is the worst version of this document,
// because it is the one where the figures are recalled rather than read.
//
// ── This is the same module as clientReport.ts, wearing the other hat ──────
//
// Deliberately built ON that file rather than beside it: `sectionState`,
// `countable`, `sectionCaveat`, `escapeHtml`, `toProgressRows` and the four
// section shapes are imported, not re-declared. A second copy of those rules is
// a second place for them to drift, and the drift would be silent — two
// documents about the same person, from the same database, disagreeing about
// what could be read.
//
// What is genuinely NEW here is the two things only a coach has:
//
//   · SESSIONS DELIVERED. `sessions` is the coach's own table and the client's
//     app never shows a tally of it. It is also the section with the trap:
//     a booked session whose outcome nobody ever recorded is NOT a session
//     that did not happen, and a count that quietly treats it as one tells the
//     next coach this person no-showed. See `sessionTally`.
//
//   · THE COACH'S OWN WORDS. The one block on the page that is somebody's
//     opinion — and it is printed under a heading that says whose, in their
//     own voice, quoted. Everything the MODULE writes is a figure, a date, or a
//     statement about what could not be read.
//
// ── The three rules, restated because this document is about somebody ──────
//
// 1. IT NEVER INTERPRETS. Not once, in anything this file writes. No "on
//    track", no "good adherence", no grade, no percentage of attendance, no
//    clinical word. The client's own report has a test scanning for FIFTEEN
//    forbidden phrases; this one has that list plus the ten a coach reaches
//    for — "compliant", "adherence", "excellent", "poor", "needs to" among
//    them. The temptation here is larger than it is on the client's copy,
//    because a coach genuinely has an opinion and the document looks like the
//    place to put it. It is: in the coach's own quoted block, attributed to
//    them, and nowhere else.
//
//    The count said "sixteen" and the examples named "consistent" and "poor".
//    The list is fifteen; "consistent" was never scanned for on its own (only
//    "consistent with", which is the client's entry); and "poor" was not
//    scanned for at all, so the header claimed a guard against the single most
//    obviously judgemental word in the set while the document was free to print
//    it. Both are on the list now — see FORBIDDEN in coachClientReport.test.ts.
//
// 2. IT NEVER CLAIMS TO BE COMPLETE WHEN IT IS NOT. SIX independent reads feed
//    it and any can fail while the others land. (This said five and the count
//    is load-bearing: the sixth is `coachStatus`, the read that names the
//    AUTHOR, and `coachReportCaveats` has always caveated it. A caller who
//    believed the coach-identity read sat outside the completeness contract
//    would treat an unattributed document as whole.) A document assembled from a
//    failed read that prints an empty Injuries table has told the next coach
//    this person has disclosed nothing — the single most dangerous false
//    statement this app can make, and it is the same one whichever app makes
//    it.
//
// 3. NO PHOTOGRAPH GOES INTO IT, AND NO URL EITHER. A coach's position here is
//    worse than a client's, not better: progress photographs reach a coach
//    because the client SHARED them with that coach specifically
//    (progress_photo_shares), one at a time, deliberately. Putting one into a
//    document the coach then forwards would launder a share with one person
//    into a share with everybody the file reaches. There is no code path in
//    this module that takes an image or a URL, and the test asserts the
//    rendered HTML contains no `<img`, no `http` and no `file:`.
//
// Pure, framework-free and asserted against under plain `node`.

import type { LoadStatus } from '../ui/loadStatus';
import { weightIn, lengthIn, volumeIn, convertedNote, type WeightUnit, type LengthUnit } from './units';
import { progressChangeLines, progressSpanLabel, figure, dayLabel } from './progressExport';
// The client's own handover document. Its rules are imported rather than
// copied — see the header. Nothing in that file is modified by this one.
import {
  sectionState,
  sectionCaveat,
  escapeHtml,
  toProgressRows,
  type ReportScan,
  type ReportMeasureColumn,
  type ReportMeasureEntry,
  type ReportTraining,
  type ReportInjury,
  type ReportSection,
} from './clientReport';

export type {
  ReportScan, ReportMeasureColumn, ReportMeasureEntry, ReportTraining, ReportInjury, ReportSection,
} from './clientReport';

/* ── what only a coach has: the sessions ──────────────────────────────────── */

/**
 * One booked session, as `sessions` holds it.
 *
 * `outcome` is nullable in the schema and the null is the whole point: it means
 * NOBODY RECORDED WHAT HAPPENED. It does not mean the session was missed, and
 * it does not mean it went ahead.
 */
export interface CoachSessionRow {
  /** ISO timestamp of the session's start. */
  startsAt: string;
  /** 'completed' | 'no_show' | 'cancelled' | 'late_cancelled', or null. */
  outcome: string | null;
}

/**
 * What the sessions come to.
 *
 * Every count is null unless the read was WHOLE, for the reason
 * src/ui/loadStatus.ts gives: a tally over a page of a longer list is not a
 * smaller tally, it is a wrong one — and this one goes on a document about a
 * person's twelve weeks.
 */
export interface SessionTally {
  state: 'unreadable' | 'none' | 'some';
  booked: number | null;
  completed: number | null;
  noShow: number | null;
  cancelled: number | null;
  lateCancelled: number | null;
  /**
   * Sessions whose outcome nobody ever recorded.
   *
   * Stated on the document as its own figure and never folded into any of the
   * four above. A coach who marks outcomes for a month and then stops has a
   * client whose record is mostly nulls, and rolling those into "no-show"
   * would hand the next coach a person who stopped turning up. Rolling them
   * into "completed" would be the same invention pointing the other way.
   */
  unrecorded: number | null;
  /** `YYYY-MM-DD` of the earliest and latest session read, or null. */
  firstDay: string | null;
  lastDay: string | null;
}

const dayOf = (iso: string): string => String(iso ?? '').slice(0, 10);

/**
 * Tally the sessions, or refuse to.
 *
 * `rows` is passed null under a failed read — the same call shape
 * `trainingBoard` uses in clientTraining.ts — so an empty array can never
 * arrive here meaning two different things.
 */
export function sessionTally(rows: readonly CoachSessionRow[] | null, status: LoadStatus): SessionTally {
  const empty: SessionTally = {
    state: 'unreadable', booked: null, completed: null, noShow: null,
    cancelled: null, lateCancelled: null, unrecorded: null, firstDay: null, lastDay: null,
  };
  if (rows == null || status === 'error' || status === 'loading') return empty;

  const days = rows.map((r) => dayOf(r.startsAt)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const firstDay = days[0] ?? null;
  const lastDay = days.length ? days[days.length - 1] : null;

  if (!rows.length) {
    return { ...empty, state: 'none', booked: 0, completed: 0, noShow: 0, cancelled: 0, lateCancelled: 0, unrecorded: 0 };
  }
  // A truncated read may be LISTED and may not be COUNTED. The span is still
  // stated — both endpoints are real sessions — but every figure is null.
  if (status === 'partial') {
    return { ...empty, state: 'some', firstDay, lastDay };
  }
  let completed = 0, noShow = 0, cancelled = 0, lateCancelled = 0, unrecorded = 0;
  for (const r of rows) {
    switch (r.outcome) {
      case 'completed': completed += 1; break;
      case 'no_show': noShow += 1; break;
      case 'cancelled': cancelled += 1; break;
      case 'late_cancelled': lateCancelled += 1; break;
      // Anything else — null, or a value a later migration added that this
      // build has never heard of — is UNRECORDED. Guessing at an unknown
      // outcome is the same invention as guessing at a null one.
      default: unrecorded += 1; break;
    }
  }
  return {
    state: 'some', booked: rows.length, completed, noShow, cancelled, lateCancelled,
    unrecorded, firstDay, lastDay,
  };
}

/* ── what the caller hands over ───────────────────────────────────────────── */

export interface CoachClientReportInput {
  /** Whose record this is. Printed, and printed first. */
  clientName: string;
  /** Who is handing it over. Null when the coach's own read failed — the
   *  document then says the author could not be established rather than
   *  printing an unsigned page that looks like the app's own assessment. */
  coachName: string | null;
  coachStatus: LoadStatus;
  brand: string;
  /** `YYYY-MM-DD`, supplied by the caller (todayISO()) rather than read from
   *  the clock here, so the document is a pure function of its inputs. */
  generatedOn: string;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  /**
   * Which person's unit preference these figures are printed in, in words.
   *
   * The coach reads in one unit and the client may read in another, and this
   * document is handed BETWEEN them. `unitFor()` in clientTraining.ts already
   * decides which wins and produces this sentence; it is passed rather than
   * re-decided, so the document and the coach's screen cannot disagree about
   * whose pounds these are. Null prints no line.
   */
  unitNote?: string | null;
  sessions: ReportSection<readonly CoachSessionRow[] | null>;
  training: ReportSection<ReportTraining>;
  composition: ReportSection<ReportScan[]>;
  measurements: ReportSection<ReportMeasureEntry[]>;
  measureColumns: ReportMeasureColumn[];
  injuries: ReportSection<ReportInjury[]>;
  /**
   * The coach's own words, typed on the screen that builds this.
   *
   * The ONE place on the page that carries an opinion, and it is quoted under
   * a heading naming its author. Empty means the coach wrote nothing, and the
   * document says that rather than leaving a heading over a blank — a reader
   * who sees an empty section assumes it failed to print.
   */
  coachNote?: string | null;
}

export interface CoachClientReportDoc {
  html: string;
  text: string;
  /** True only when all SIX reads were whole — the five content sections and
   *  the `coachStatus` read that names who prepared the document. `complete`
   *  is `coachReportCaveats(...).length === 0`, and that function has always
   *  caveated the author read; this said "five", which invited a caller to
   *  treat an unattributed report as a whole one. */
  complete: boolean;
  caveats: string[];
}

/* ── the standing statements ──────────────────────────────────────────────── */

/**
 * What this document is, said on the document.
 *
 * The reader is the client themselves, or the coach who takes them on next.
 * Both will read a printed page with a logo on it as an official record of a
 * body, and it is not one: it is what got typed into an app, by three different
 * people, over a period. Where each figure came from decides how much weight it
 * can carry.
 */
export const COACH_REPORT_PROVENANCE = [
  'This is a record of what was entered in this app about the person named above, printed by their coach.',
  'Sessions are the ones booked in this app and the outcome their coach recorded against each. Training is what was logged, by the client or by their coach. Body-composition figures are transcribed from body-composition machine printouts — read automatically from a photograph, or typed in by hand — and are not measured by this app. Tape measurements are taken by hand.',
  'Dates are the dates recorded against each entry. Where something was not recorded it is shown as a dash, never as a zero.',
];

/**
 * What this document is not.
 *
 * A constant so it cannot be softened on one screen and left alone on another,
 * and so the test can assert it is on every document this module builds —
 * including the empty one built for somebody with no record at all.
 */
export const COACH_REPORT_LIMITS =
  'This document contains no assessment, no rating and no advice. It is a record of what was booked, logged and measured. Nothing in it is a clinical judgement, a score, or a statement about what this person should do next, and no figure in it has been reviewed by a clinician.';

/** Said out loud because the absence is itself information — and because a
 *  coach's photographs of a client reached them through a share with THAT
 *  coach, which a forwarded file would quietly turn into a share with
 *  everybody. */
export const COACH_REPORT_NO_PHOTOS =
  'No photographs are included. Progress photographs are shared by the client with one coach at a time and are never attached to a document. Documents a client uploaded about an injury are likewise not included — only the injury they recorded from them.';

/**
 * Why there is no attendance percentage on this page.
 *
 * The obvious thing to print is "attended 22 of 24 — 92%", and it is the one
 * figure on this document that would be read as a grade. It is also arithmetic
 * over a set that contains sessions nobody recorded an outcome for, which makes
 * the denominator a number and the numerator a guess.
 */
export const COACH_REPORT_NO_RATE =
  'No attendance rate or percentage is stated. Sessions whose outcome nobody recorded are counted separately below and are not treated as missed or as attended, so a percentage over them would not measure anything.';

/* ── read honesty ─────────────────────────────────────────────────────────── */

/** Every caveat this document has to carry, in the order the sections appear. */
export function coachReportCaveats(input: CoachClientReportInput): string[] {
  return [
    sectionCaveat('Who prepared this', input.coachStatus),
    sectionCaveat('Sessions', input.sessions.status),
    sectionCaveat('Training logged', input.training.status),
    sectionCaveat('Body composition', input.composition.status),
    sectionCaveat('Tape measurements', input.measurements.status),
    sectionCaveat('Injuries disclosed', input.injuries.status),
  ].filter((s): s is string => s !== null);
}

/* ── plumbing ─────────────────────────────────────────────────────────────── */

const num = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString();

const unitised = (text: string, unit: string): string => (text === '—' ? '—' : `${text} ${unit}`);

const partialNote = (what: string): string =>
  `Not all of this person’s ${what} could be read in one request. What is listed is real; it is not all of it.`;

function oldestFirst<T>(items: readonly T[], at: (x: T) => string): T[] {
  return [...items].sort((a, b) => {
    const d = Date.parse(at(a)) - Date.parse(at(b));
    return Number.isFinite(d) ? d : 0;
  });
}

/** How many logged training days the table lists. Same cap as the client's own
 *  document, so the two never show a different slice of the same history. */
export const COACH_TRAINING_DAYS_SHOWN = 30;

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
  .quote{border-left:4px solid #cbd5e1;padding:2px 0 2px 14px;margin:10px 0;font-style:italic;color:#334155;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .r{text-align:right}
  .none{color:#64748b}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px}
`;

const unreadableBlock = (what: string): string =>
  `<p class="none"><b>Not read.</b> ${escapeHtml(what)} could not be read from the server when this document was made, so nothing is listed here. This is not a statement that there is none on record.</p>`;

const emptyBlock = (what: string): string => `<p class="none">${escapeHtml(what)}</p>`;

/* ── the document ─────────────────────────────────────────────────────────── */

/**
 * The whole document, in HTML and in plain text.
 *
 * Both are built from the same values in the same order so the text a coach
 * sends from a build with no expo-print says exactly what the PDF would have
 * said — every caveat included.
 */
export function coachClientReportDoc(input: CoachClientReportInput): CoachClientReportDoc {
  const caveats = coachReportCaveats(input);
  const complete = caveats.length === 0;
  const wu = input.weightUnit;
  const lu = input.lengthUnit;
  const who = (input.clientName || '').trim() || 'This client';
  const brand = (input.brand || '').trim() || 'Repple';
  const coachRead = sectionState(input.coachStatus) !== 'unreadable';
  const coach = (input.coachName || '').trim();
  const note = (input.coachNote || '').trim();

  const H: string[] = [];
  const T: string[] = [];

  /* ── heading ───────────────────────────────────────────────────────────── */
  H.push(`<div class="h"><h1>Coaching record</h1><p>${escapeHtml(who)} · prepared ${escapeHtml(dayLabel(input.generatedOn))} · ${escapeHtml(brand)}</p></div>`);
  T.push(`${who} — coaching record`);
  T.push(`Prepared ${dayLabel(input.generatedOn)} · ${brand}`);

  /* ── who prepared it ───────────────────────────────────────────────────── */
  //
  // First, not last. An unsigned page that opens with figures reads as the
  // app's own assessment of a person; a page that opens with a name reads as
  // one person handing something to another. The failure branch says exactly
  // that rather than leaving the line blank.
  H.push('<h2>Who prepared this</h2>');
  T.push('', 'WHO PREPARED THIS');
  if (!coachRead) {
    H.push(unreadableBlock('The name of the coach preparing this'));
    T.push('Not read — the name of the coach preparing this could not be read. This document is NOT an assessment produced by the app.');
  } else if (!coach) {
    H.push(emptyBlock('The coach preparing this has not recorded a name on their account.'));
    T.push('The coach preparing this has not recorded a name on their account.');
  } else {
    H.push(`<p>Prepared by <b>${escapeHtml(coach)}</b>, who coaches ${escapeHtml(who)} through ${escapeHtml(brand)}.</p>`);
    T.push(`Prepared by ${coach}, who coaches ${who} through ${brand}.`);
  }

  /* ── what this is, and is not ──────────────────────────────────────────── */
  H.push('<h2>About this document</h2>');
  T.push('', 'ABOUT THIS DOCUMENT');
  for (const line of COACH_REPORT_PROVENANCE) { H.push(`<p class="lede">${escapeHtml(line)}</p>`); T.push(line); }
  H.push(`<p class="lede">${escapeHtml(COACH_REPORT_LIMITS)}</p>`);
  T.push(COACH_REPORT_LIMITS);
  H.push(`<p class="lede">${escapeHtml(COACH_REPORT_NO_PHOTOS)}</p>`);
  T.push(COACH_REPORT_NO_PHOTOS);
  if (input.unitNote) {
    H.push(`<p class="lede">${escapeHtml(input.unitNote)}</p>`);
    T.push(input.unitNote);
  }

  /* ── the caveats, at the top, where they cannot be scrolled past ───────── */
  if (!complete) {
    H.push('<div class="warn"><h3>This record is incomplete</h3><ul>');
    T.push('', '*** THIS RECORD IS INCOMPLETE ***');
    for (const c of caveats) { H.push(`<li>${escapeHtml(c)}</li>`); T.push('- ' + c); }
    H.push('</ul></div>');
  }

  /* ── sessions ──────────────────────────────────────────────────────────── */
  {
    const st = sectionState(input.sessions.status);
    const tally = sessionTally(input.sessions.items, input.sessions.status);
    H.push('<h2>Sessions booked in this app</h2>');
    T.push('', 'SESSIONS BOOKED IN THIS APP');
    if (st === 'unreadable' || tally.state === 'unreadable') {
      H.push(unreadableBlock('Sessions'));
      T.push('Not read — sessions could not be read. This is not a statement that none were booked.');
    } else if (tally.state === 'none') {
      H.push(emptyBlock('No sessions were booked with this coach in this app. Sessions arranged any other way are not recorded here.'));
      T.push('No sessions were booked with this coach in this app. Sessions arranged any other way are not recorded here.');
    } else {
      if (st === 'partial') {
        const p = partialNote('sessions');
        H.push(`<p class="lede"><b>${escapeHtml(p)}</b></p>`);
        T.push(p);
      }
      if (tally.firstDay && tally.lastDay) {
        const span = tally.firstDay === tally.lastDay
          ? `One day on record: ${dayLabel(tally.firstDay)}.`
          : `From ${dayLabel(tally.firstDay)} to ${dayLabel(tally.lastDay)}.`;
        H.push(`<p class="lede">${escapeHtml(span)}</p>`);
        T.push(span);
      }
      const rows: [string, string][] = [
        ['Booked', num(tally.booked)],
        ['Coach recorded: went ahead', num(tally.completed)],
        ['Coach recorded: did not attend', num(tally.noShow)],
        ['Coach recorded: cancelled', num(tally.cancelled)],
        ['Coach recorded: cancelled late', num(tally.lateCancelled)],
        ['No outcome recorded either way', num(tally.unrecorded)],
      ];
      H.push(`<table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="r">${escapeHtml(v)}</td></tr>`).join('')}</table>`);
      for (const [k, v] of rows) T.push(`  ${k}: ${v}`);
      // The line that stops the last row being read as an absence.
      const unrec = 'A session with no outcome recorded is one nobody marked either way. It is not a session that was missed and it is not one that went ahead.';
      H.push(`<p class="lede">${escapeHtml(unrec)}</p>`);
      T.push(unrec);
      H.push(`<p class="lede">${escapeHtml(COACH_REPORT_NO_RATE)}</p>`);
      T.push(COACH_REPORT_NO_RATE);
      if (st === 'partial') {
        const noCount = 'No counts are stated for this section: more sessions are on record than could be read in one request, so any total would be a total of part of them.';
        H.push(`<p class="lede">${escapeHtml(noCount)}</p>`);
        T.push(noCount);
      }
    }
  }

  /* ── training logged ───────────────────────────────────────────────────── */
  //
  // The totals are already null under anything but a whole read — decided in
  // clientTraining.ts and honoured here, not re-decided.
  {
    const st = sectionState(input.training.status);
    const b = input.training.items;
    H.push('<h2>Training logged</h2>');
    T.push('', 'TRAINING LOGGED');
    if (st === 'unreadable' || b.state === 'unreadable') {
      H.push(unreadableBlock('Logged training'));
      T.push('Not read — logged training could not be read. This is not a statement that none was logged.');
    } else if (!b.days.length && b.undatedCount < 1) {
      H.push(emptyBlock('No training sessions are logged in this app.'));
      T.push('No training sessions are logged in this app.');
    } else {
      if (st === 'partial') {
        const p = partialNote('logged training');
        H.push(`<p class="lede"><b>${escapeHtml(p)}</b></p>`);
        T.push(p);
      }
      const totals: [string, string][] = [
        ['Days trained', num(b.dayCount)],
        ['Separate logging events', num(b.entryCount)],
        ['Sets recorded', num(b.sets)],
        [`Total load moved (${wu})`, num(volumeIn(b.volumeKg, wu))],
        ['Most recent day', b.newestDay ? dayLabel(b.newestDay) : '—'],
      ];
      H.push(`<table>${totals.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="r">${escapeHtml(v)}</td></tr>`).join('')}</table>`);
      for (const [k, v] of totals) T.push(`  ${k}: ${v}`);
      const loadNote = 'Load moved is the sum of repetitions × weight over the sets that carried a weight. Sets done against bodyweight alone carry no load to total and are counted separately below, so a low figure here is not a light history.';
      H.push(`<p class="lede">${escapeHtml(loadNote)}</p>`);
      T.push('Load moved is the sum of repetitions x weight over the sets that carried a weight; bodyweight sets carry no load to total.');

      if (b.undatedCount > 0) {
        const u = `${num(b.undatedCount)} logging event${b.undatedCount === 1 ? '' : 's'} carr${b.undatedCount === 1 ? 'ies' : 'y'} a timestamp that could not be read, so ${b.undatedCount === 1 ? 'it does' : 'they do'} not appear in the table of days below. The sets and load in ${b.undatedCount === 1 ? 'it are' : 'them are'} counted in the figures above.`;
        H.push(`<p class="lede">${escapeHtml(u)}</p>`);
        T.push(u);
      }
      const shown = b.days.slice(0, COACH_TRAINING_DAYS_SHOWN);
      if (!shown.length) {
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

  /* ── body composition ──────────────────────────────────────────────────── */
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
      // Subtraction between two readings that both exist, printed with both
      // endpoints and no adjective on it. Stated only over a WHOLE read: a
      // truncated set is a prefix of an unknown whole, so its "first" reading
      // is not this person's first.
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
        // The text fallback carries the WHOLE sentence, not a shortened one.
        // A coach on a build with no expo-print sends this text, and the half
        // that matters is the second half — why the change is missing.
        const noChange = 'No overall change is stated: not all of this person’s scans could be read, so the earliest one listed may not be their first.';
        H.push(`<p class="lede">${escapeHtml(noChange)}</p>`);
        T.push(noChange);
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

  /* ── injuries disclosed ────────────────────────────────────────────────── */
  //
  // The section the NEXT coach opens this for, and the one where an empty table
  // produced by a failed read would be actively dangerous.
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
      const grading = 'Severity and state are as the person themselves recorded them, in the app’s own three-step wording. They are not a clinical grading and the coach did not assign them.';
      H.push(`<p class="lede">${escapeHtml(grading)}</p>`);
      T.push(grading);
    }
  }

  /* ── the coach's own words ─────────────────────────────────────────────── */
  //
  // The only opinion on the page, quoted, under a heading that names its
  // author. It is escaped like everything else — a coach writing "<3 weeks off
  // pressing>" would otherwise take the rest of the document with it, and this
  // block sits above the footer that says whether the document is complete.
  {
    H.push('<h2>In the coach’s own words</h2>');
    T.push('', 'IN THE COACH’S OWN WORDS');
    if (!note) {
      // Said, rather than left blank. An empty section reads as one that failed
      // to print, and a reader would go looking for the missing paragraph.
      H.push(emptyBlock('The coach did not write anything here.'));
      T.push('The coach did not write anything here.');
    } else {
      const attrib = coachRead && coach
        ? `The following is written by ${coach}, in their own words. It is their opinion, not a finding of this app and not a clinical assessment.`
        : 'The following is written by the coach preparing this, in their own words. It is their opinion, not a finding of this app and not a clinical assessment.';
      H.push(`<p class="lede">${escapeHtml(attrib)}</p>`);
      T.push(attrib);
      H.push(`<div class="quote">${escapeHtml(note)}</div>`);
      T.push('  “' + note + '”');
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
 * A coach about to hand a document to a client — or to the coach taking them
 * on — is entitled to know in advance that a section of it is missing.
 * Afterwards is too late: the file is already in somebody else's inbox.
 */
export function coachReportShareBlurb(doc: CoachClientReportDoc, clientName: string): string {
  const who = (clientName || '').trim() || 'this client';
  const base = `A record of ${who}'s sessions, logged training, body-composition scans, tape measurements and any injuries they have disclosed. It contains no assessment or rating of any kind, and no photographs.`;
  if (doc.complete) return base;
  return base + `\n\nBEFORE YOU SEND IT: ${doc.caveats.length} part`
    + (doc.caveats.length === 1 ? '' : 's')
    + ' of the record could not be read just now, so the document says so on its own front page rather than looking complete. You can send it as it is, or close this and try again in a moment.';
}
