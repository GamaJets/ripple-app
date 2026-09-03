// The period an export covers, and saying so.
//
// `/export` asked for everything. Two constants sat at the top of the screen —
// `FROM = '1970-01-01'`, `TO = '2100-01-01'` — with no control beside them, so
// the only request the console could answer was "all of it". Every request an
// accountant or an auditor actually makes is for a period: a financial year, a
// quarter, the months either side of an incident. An owner asked for one had to
// export the whole record and cut it up in a spreadsheet, which is the step
// where a figure stops being evidence.
//
// ── Why this is a module and not two date inputs ──────────────────────────
//
// Because the dangerous half of a bounded export is not the filtering. It is
// what the file says about itself afterwards. A bundle of nineteen CSVs that
// LOOKS like the gym's whole record and is in fact one quarter of it is worse
// than no export at all: it is the same nineteen filenames, the same README,
// and the reader has no way to tell. So the window travels with the bundle —
// into the filename, into the manifest, into the first line of the README, and
// into a per-part statement of which files it actually narrowed.
//
// That last one is the part nobody expects. A window does NOT narrow every
// part, and the ones it leaves whole are not an oversight:
//
//   · A membership is a PERIOD, not an instant. One that ran all through your
//     quarter may have started four years before it, and bounding on its start
//     date would drop exactly the memberships the quarter is about.
//   · An agreement is the WORDING somebody signed. Bound the agreements to
//     2026 and a signature from 2026 pointing at a waiver published in 2019
//     names a document that is not in the bundle.
//   · The price book, the pass types, the equipment register and the promo
//     codes are standing records with no event date to bound them by.
//
// So a part is either bounded by a named column or it is whole, the bundle
// lists which is which, and neither state is left for the reader to infer.
//
// ── Why an unplaceable row is kept rather than dropped ────────────────────
//
// A row whose bounding date was never recorded cannot be put inside or outside
// a period. Dropping it makes the claim "this did not happen in your window",
// which is a claim nothing here can make; keeping it makes the weaker and true
// one, "this is in the file and could not be placed". So it is kept, counted,
// and named in the README. Silence is the only answer that would be wrong.
//
// ── Why timestamps are parsed rather than compared as strings ─────────────
//
// `'2026-01-01' < '2026-01-01T00:00:00.000Z'` is true as text and false as
// time, and a timestamp carrying a +02:00 offset sorts by its local date rather
// than its instant. Both would silently move rows across the boundary. Every
// value goes through `instantOf` instead, which is also why a timestamp with NO
// zone is refused: `Date.parse` would read it in whichever zone the laptop is
// set to, and the same export taken in Dubai and in Los Angeles would cover
// different rows.
//
// Pure and framework-free, like gymExport.ts beside it: no runtime import of
// any kind, so the whole of it is testable without a database or a browser.

/**
 * The bounds an export was taken over.
 *
 * Null on either side means open-ended, and null on BOTH means the window was
 * never set — which is the whole record and is a different claim from a very
 * wide window. `isBounded` is what the rest of the codebase asks; nothing
 * should test the two fields itself and get that distinction wrong.
 */
export interface ExportWindow {
  /** Inclusive lower bound as an ISO instant, or null for "from the beginning". */
  from: string | null;
  /** Inclusive upper bound as an ISO instant, or null for "up to now". */
  to: string | null;
}

/** The whole record. Not a wide window — the absence of one. */
export const NO_WINDOW: ExportWindow = { from: null, to: null };

/** True when this export covers a period rather than everything. */
export function isBounded(w: ExportWindow): boolean {
  return w.from !== null || w.to !== null;
}

/* ── instants ──────────────────────────────────────────────────────────────── */

/**
 * A stored date or timestamp as a millisecond instant, or null when it is not
 * one this module is willing to place.
 *
 * Three shapes are accepted and everything else is null:
 *
 *   `2026-03-31`                    a date, read as UTC midnight
 *   `2026-03-31T23:00:00Z`          a timestamp with a zone
 *   `2026-04-01T01:00:00+02:00`     the same instant, written differently
 *
 * A timestamp with NO zone is deliberately refused rather than guessed. It is
 * the one input where guessing is invisible: `Date.parse` would apply the
 * running machine's offset, so the same gym exporting the same quarter from two
 * offices would get two different files and nothing would say why. A refusal
 * here becomes an unplaceable row, which is kept and counted — see the header.
 */
export function instantOf(v: string | null | undefined): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Built from the parts rather than parsed, because `new Date('2026-03-31')`
    // is UTC and `new Date('2026/03/31')` is local, and only one of those two
    // spellings is ever more than a typo away.
    const ms = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    return Number.isFinite(ms) ? ms : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return null;
  const ms = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

/** Where one row's date falls. `undated` is neither in nor out — see the header
 *  on why that is a third answer rather than a rounding of the other two. */
export type Placement = 'inside' | 'outside' | 'undated';

export function placeInWindow(ts: string | null | undefined, w: ExportWindow): Placement {
  const t = instantOf(ts);
  if (t === null) return 'undated';
  const from = instantOf(w.from);
  if (from !== null && t < from) return 'outside';
  const to = instantOf(w.to);
  if (to !== null && t > to) return 'outside';
  return 'inside';
}

/* ── the two days somebody typed ───────────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The first instant of a day, UTC. '' for anything that is not a day. */
export function dayStart(day: string | null | undefined): string | null {
  const s = (day ?? '').trim();
  if (!DAY.test(s)) return null;
  const ms = instantOf(s);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * The LAST instant of a day, UTC.
 *
 * Not the following midnight. A window written as "1 January to 31 March" means
 * the whole of 31 March to everybody who types it, and an upper bound of
 * `2026-03-31T00:00:00Z` would silently drop that day's takings — the single
 * most likely way for a bounded export to be quietly wrong, because it is only
 * ever wrong by one day at one end.
 */
export function dayEnd(day: string | null | undefined): string | null {
  const s = (day ?? '').trim();
  if (!DAY.test(s)) return null;
  const ms = instantOf(s);
  return ms === null ? null : new Date(ms + 86_400_000 - 1).toISOString();
}

/** The window two date inputs describe. Either may be blank for open-ended. */
export function windowFromDays(fromDay: string, toDay: string): ExportWindow {
  return { from: dayStart(fromDay), to: dayEnd(toDay) };
}

/**
 * Why the typed period cannot be used, or null when it can.
 *
 * Blank is not an error on either side: an open-ended window is a real request
 * ("everything since we opened the second site"). A date that is not a date is,
 * and so is a period that runs backwards — a from after a to silently produces
 * an export with nothing in it, and an empty bundle reads as a gym that did
 * nothing rather than as a range typed the wrong way round.
 */
export function windowBlocker(fromDay: string, toDay: string): string | null {
  const f = (fromDay ?? '').trim();
  const t = (toDay ?? '').trim();
  if (f && !DAY.test(f)) return 'The start of the period is not a date. It wants a day, as 2026-01-01.';
  if (t && !DAY.test(t)) return 'The end of the period is not a date. It wants a day, as 2026-03-31.';
  if (f && t) {
    const a = instantOf(f);
    const b = instantOf(t);
    if (a === null || b === null) return 'One of those days does not exist.';
    if (a > b) {
      return 'The period ends before it starts. Exporting it would produce a bundle with nothing in it, which reads as a gym that did nothing rather than as two dates the wrong way round.';
    }
  }
  return null;
}

/* ── saying it ─────────────────────────────────────────────────────────────── */

/** The day part of an instant, for prose and filenames. */
export function dayOf(iso: string | null | undefined): string {
  const s = (iso ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * The window as a filename fragment, or '' when there is none.
 *
 * `until-` rather than a bare `to-` on an open lower bound, so the one-sided
 * form cannot be misread as the tail of a two-sided one: `…-until-2026-03-31`
 * and `…-2026-01-01-to-2026-03-31` are unambiguous side by side in a folder,
 * and a folder side by side is exactly where these end up.
 */
export function windowSlug(w: ExportWindow): string {
  const a = dayOf(w.from);
  const b = dayOf(w.to);
  if (a && b) return `${a}-to-${b}`;
  if (a) return `from-${a}`;
  if (b) return `until-${b}`;
  return '';
}

/** The window in the words a person reads. Always a complete sentence about
 *  what the bundle covers, including the unbounded case. */
export function describeWindow(w: ExportWindow): string {
  const a = dayOf(w.from);
  const b = dayOf(w.to);
  if (a && b) return `${a} to ${b} inclusive`;
  if (a) return `${a} onwards`;
  if (b) return `everything up to and including ${b}`;
  return 'the whole record, with no period applied';
}

/* ── the periods people actually ask for ───────────────────────────────────── */

export type PresetId = 'all' | 'thisMonth' | 'lastMonth' | 'last90' | 'thisYear' | 'lastYear';

export const PRESET_LABEL: Record<PresetId, string> = {
  all: 'Everything',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last90: 'Last 90 days',
  thisYear: 'This year',
  lastYear: 'Last year',
};

export const PRESET_IDS: readonly PresetId[] =
  ['all', 'thisMonth', 'lastMonth', 'last90', 'thisYear', 'lastYear'] as const;

/**
 * The two days a preset fills the boxes with.
 *
 * `today` is passed in rather than read from the clock, so this is pure and so
 * the suite can run it under six timezones and get one answer. Everything is
 * computed in UTC for the same reason: a calendar year that starts on a
 * different day depending on where the laptop is would put a different set of
 * payments in a file labelled the same way.
 *
 * "This year" and "this month" run to TODAY rather than to the end of the
 * period. A window whose upper bound is in the future would put a date on the
 * bundle that nothing in it could reach, and an accountant reading `to
 * 2026-12-31` on a file taken in September is being told something false about
 * how much of the year it holds.
 */
export function presetDays(id: PresetId, today: string): { from: string; to: string } {
  const t = instantOf(today);
  if (id === 'all' || t === null) return { from: '', to: '' };
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  // `utcIso` rather than `iso`, because every one of its arguments below is a
  // `Date.UTC(...)` and `instantOf` builds `t` the same way — UTC goes in and
  // the same UTC day comes back out, which is what makes this pure and what the
  // note above is describing when it says the suite gets one answer under six
  // timezones. Reading these back with the LOCAL getters, which is the usual
  // repair for `toISOString().slice(0, 10)`, would be the actual bug here: the
  // first of the month built at UTC midnight reads back as the last day of the
  // month before for every laptop west of Greenwich, and an accountant would
  // get a file labelled September holding a payment from August.
  const utcIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const todayDay = utcIso(t);
  switch (id) {
    case 'thisMonth':
      return { from: utcIso(Date.UTC(y, m, 1)), to: todayDay };
    case 'lastMonth':
      // Day 0 of a month is the last day of the one before it, which is the
      // only spelling of "the end of last month" that is right in February.
      return { from: utcIso(Date.UTC(y, m - 1, 1)), to: utcIso(Date.UTC(y, m, 0)) };
    case 'last90':
      return { from: utcIso(t - 89 * 86_400_000), to: todayDay };
    case 'thisYear':
      return { from: utcIso(Date.UTC(y, 0, 1)), to: todayDay };
    case 'lastYear':
      return { from: utcIso(Date.UTC(y - 1, 0, 1)), to: utcIso(Date.UTC(y - 1, 11, 31)) };
  }
}
