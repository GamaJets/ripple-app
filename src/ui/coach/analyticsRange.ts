// The four windows a coach reads their book over, and what each may say.
//
// The approved board opens Analytics on a 7D / 30D / 90D / 1Y chip row over
// two figures — the book's adherence and its program completions — each with
// a delta against the window before and a chart of the window's periods. This
// module is the part of that which has to be RIGHT rather than merely drawn:
// which days a window covers, how it is cut into bars, what is read for it,
// and the one rule every figure obeys — nothing is stated off a read that did
// not come back whole.
//
// ── Where the two figures come from ────────────────────────────────────────
//
// Adherence is the client's OWN rating at check-in — `check_ins.adherence`, a
// 1–5 self-rating from the Rating control on the client check-in screen. The
// roster (src/ui/roster.tsx) already converts each client's newest one to a
// percentage and every coach surface prints that, so the same conversion is
// used here over EVERY check-in in the window rather than the newest one: the
// window's figure is the mean of what clients said about themselves across it.
// Not src/lib/adherence.ts's tick-rate, which needs a per-client list of coach
// items to have a denominator at all and refuses to invent one; a book-wide
// rate over four windows has no such list, and the rating is the one measure
// that already exists for every client at once.
//
// Completions are logged workout sessions — one `workouts` row is one session
// a client recorded, which is a program day done. Read by `performed_at`,
// the same column src/lib/clientDrift.ts takes as evidence a client trained.
// It is NOT a count of programs finished: nothing in the record marks a block
// as complete, and the screen's caption says so.
//
// ── The window ends yesterday ──────────────────────────────────────────────
//
// `recentWindow` from src/lib/adherence.ts, on that file's reasoning: today is
// not over, and letting it into a denominator makes the figure worst first
// thing in the morning and better by bedtime, which is a property of the clock
// rather than of anybody's clients. The "N days before" window is the same
// length again, ending the day before this one starts, so the delta compares
// like with like.
//
// ── A truncated read produces no figure ────────────────────────────────────
//
// Both reads are capped (`readCappedByIds`, see src/lib/cappedByIds.ts). A
// year of check-ins for an active book can pass PostgREST's ceiling, and a
// mean over the rows that happened to come back is not a smaller figure, it is
// a wrong one — so a capped read is reported 'partial' and the screen draws a
// dash and says why. The two windows are read separately for exactly this
// reason: the current window is the one the coach is looking at, and it should
// not be withheld because the comparison behind it came back short.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { reportError } from '../../lib/reportError';
import { readCappedByIds } from '../../lib/cappedByIds';
import { capLimit } from '../../lib/rowCap';
import { recentWindow, type DayWindow } from '../../lib/adherence';
import { dateParts } from '../../lib/localDate';
import { dayKeyOf, dayKeyOfDate } from '../../lib/entryEdit';
import { isQueryableId } from '../../lib/clientDrift';
import { type LoadStatus } from '../loadStatus';

export type RangeKey = '7D' | '30D' | '90D' | '1Y';

export interface RangeDef {
  key: RangeKey;
  /** The chip. */
  label: string;
  /** Complete days in the window. */
  days: number;
  /** Days per bar. */
  bucketDays: 1 | 7;
  /** What the chip says to a screen reader, and the caption's phrase. */
  spoken: string;
}

/**
 * The chips, in the board's order.
 *
 * 90D is 91 days and 1Y is 364, so that each is a whole number of weeks and
 * every bar on those two charts covers the same seven days. A 90-day window cut
 * into weeks leaves a six-day stub as its last bar, which draws as a fall on
 * the right-hand side of the chart — where the eye lands — that is a property
 * of the arithmetic and not of the book. The chip still reads "90D" and "1Y"
 * as the board writes them; the caption states the exact count.
 */
export const RANGES: readonly RangeDef[] = [
  { key: '7D', label: '7D', days: 7, bucketDays: 1, spoken: 'Last 7 days' },
  { key: '30D', label: '30D', days: 30, bucketDays: 1, spoken: 'Last 30 days' },
  { key: '90D', label: '90D', days: 91, bucketDays: 7, spoken: 'Last 90 days' },
  { key: '1Y', label: '1Y', days: 364, bucketDays: 7, spoken: 'Last year' },
];

/** One bar's span, as inclusive local day keys. `key` is its first day and is
 *  what the axis prints — src/lib/chartAxis.ts reads 'YYYY-MM-DD' for itself. */
export interface Bucket { key: string; from: string; to: string }

/** A Date at local midnight of a day key, or null for a key that is not a day. */
function dayStart(day: string): Date | null {
  const p = dateParts(day);
  return p ? new Date(p[0], p[1], p[2]) : null;
}

/**
 * The window cut into bars, first to last.
 *
 * Stepped by day rather than by adding milliseconds, for the reason
 * `recentWindow` gives: two days a year are not 24 hours long, and a window
 * that shortens or lengthens by an hour under a coach's feet is a window whose
 * last bar quietly covers a different set of days.
 */
export function bucketsOf(w: DayWindow, bucketDays: number): Bucket[] {
  const start = dayStart(w.start);
  if (!start) return [];
  const step = Math.max(1, Math.floor(bucketDays));
  const out: Bucket[] = [];
  for (let i = 0; i < w.days; i += step) {
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const last = Math.min(i + step - 1, w.days - 1);
    const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + last);
    const key = dayKeyOfDate(from);
    out.push({ key, from: key, to: dayKeyOfDate(to) });
  }
  return out;
}

/** The same number of days again, ending the day before `w` starts — or null
 *  when the window's own start is not a readable day, which is unreachable
 *  off `recentWindow` and is named rather than papered over with a guess. */
export function priorWindow(w: DayWindow): DayWindow | null {
  // `recentWindow` ends its window the day BEFORE the instant it is given, so
  // handing it the first day of this window gives the run that ends the day
  // before it — which is the comparison.
  const start = dayStart(w.start);
  return start ? recentWindow(start, w.days) : null;
}

/** What one window's read came back with. */
export interface RangeRead {
  /** 'partial' when either read hit its row ceiling: the rows are real, the
   *  SET is a prefix, and no figure is computed over it. */
  status: LoadStatus;
  /** How many of the ids handed in were put to the database. Zero when nobody
   *  on the roster has an account to have recorded anything with. */
  asked: number;
  /** One per check-in in the window: the local day and the rating as a
   *  percentage. */
  checkIns: { day: string; pct: number }[];
  /** One per logged workout session in the window: the local day. */
  workouts: { day: string }[];
}

const NOTHING_YET: RangeRead = { status: 'loading', asked: 0, checkIns: [], workouts: [] };

/**
 * A 1–5 self-rating as the percentage every coach surface prints. Twenty
 * points per rating point — the same arithmetic src/ui/roster.tsx applies to
 * the newest check-in, written once here for every check-in in a window.
 */
const PCT_PER_POINT = 20;

/**
 * Both reads for one window, keyed on the ids and the window so a roster
 * provider handing back a new array of the same people does not re-read.
 * `nonce` is the screen's own refresh counter — bump it and this reads again.
 *
 * `ids` should be the roster's linked clients, handed in only when the roster
 * came back whole: a fragment of a book is not the book, and this hook cannot
 * see how the roster read went. The caller's own gate speaks first.
 */
export function useRangeActivity(ids: readonly string[], w: DayWindow, nonce = 0): RangeRead {
  const [read, setRead] = useState<RangeRead>(NOTHING_YET);
  const key = ids.join(',');

  useEffect(() => {
    let live = true;
    const askable = (key ? key.split(',') : []).filter(isQueryableId);
    // Nobody to ask about is a real, empty answer — not a read in flight. The
    // screen says why the answer is empty ("everyone was added by hand"), and
    // it must not read as a book where nobody checked in.
    if (askable.length < 1) {
      setRead({ status: 'ready', asked: 0, checkIns: [], workouts: [] });
      return;
    }
    setRead(NOTHING_YET);
    // Local midnight at both ends, as instants. The columns are timestamptz
    // and the window is a run of the READER's days, so the bound is the day's
    // own midnight and not UTC's — the whole subject of src/lib/localDate.ts.
    // The day after the last day, exclusive, is the upper bound.
    const from = dayStart(w.start);
    const endDay = dayStart(w.end);
    if (!from || !endDay) {
      setRead({ status: 'error', asked: askable.length, checkIns: [], workouts: [] });
      return;
    }
    const fromIso = from.toISOString();
    const toIso = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1).toISOString();
    // Rows outside the window are dropped here as well, rather than trusted to
    // have been filtered by the query — src/lib/adherence.ts's rule.
    const inWindow = (day: string | null): day is string => day != null && day >= w.start && day <= w.end;

    (async () => {
      try {
        const ci = await readCappedByIds<{ user_id: string; at: string; adherence: unknown }>(askable,
          (chunk) => supabase.from('check_ins').select('user_id, at, adherence')
            .in('user_id', chunk).gte('at', fromIso).lt('at', toIso).limit(capLimit()));
        if (ci.error) throw ci.error;
        const wo = await readCappedByIds<{ user_id: string; performed_at: string }>(askable,
          (chunk) => supabase.from('workouts').select('user_id, performed_at')
            .in('user_id', chunk).gte('performed_at', fromIso).lt('performed_at', toIso).limit(capLimit()));
        if (wo.error) throw wo.error;
        if (!live) return;

        const checkIns: RangeRead['checkIns'] = [];
        for (const r of ci.rows) {
          const day = dayKeyOf(r.at);
          // A check-in with no rating is a check-in and not a rating of nought:
          // it is left out of the mean rather than pulled into it as zero.
          if (!inWindow(day) || typeof r.adherence !== 'number' || !Number.isFinite(r.adherence)) continue;
          checkIns.push({ day, pct: Math.round(Math.max(1, Math.min(5, r.adherence)) * PCT_PER_POINT) });
        }
        const workouts: RangeRead['workouts'] = [];
        for (const r of wo.rows) {
          const day = dayKeyOf(r.performed_at);
          if (inWindow(day)) workouts.push({ day });
        }
        setRead({
          status: ci.truncated || wo.truncated ? 'partial' : 'ready',
          asked: askable.length,
          checkIns,
          workouts,
        });
      } catch (e: any) {
        if (!live) return;
        reportError('useRangeActivity', e);
        setRead({ status: 'error', asked: askable.length, checkIns: [], workouts: [] });
      }
    })();
    return () => { live = false; };
  }, [key, w.start, w.end, nonce]);

  return read;
}

/** The two figures and their bars, over one whole read. */
export interface RangeFigures {
  /** Mean self-rated adherence across every check-in in the window, or null
   *  when there was none — an absence of check-ins is not a rate of nought. */
  adherence: number | null;
  /** How many check-ins that mean is over. Said in the caption, because a
   *  figure over three check-ins and a figure over three hundred read the
   *  same on their own. */
  checkIns: number;
  /** Per bar; null where nobody checked in, which the chart draws as a gap. */
  adherenceByBucket: (number | null)[];
  /** Sessions logged in the window. A counted zero under a whole read. */
  completions: number;
  /** Per bar. Zero is a real count here: the read was whole and there was
   *  nothing, which is different from nobody having checked in. */
  completionsByBucket: number[];
}

/**
 * The figures. Pure, and to be called only over a whole read — the screen
 * gates on `isWhole(read.status)` and the roster's own status before it gets
 * here, because a mean over part of a set is not a smaller mean.
 */
export function rangeFigures(read: RangeRead, buckets: readonly Bucket[]): RangeFigures {
  const sums = buckets.map(() => ({ pct: 0, n: 0, done: 0 }));
  const slot = (day: string): number => buckets.findIndex((b) => day >= b.from && day <= b.to);
  let pctAll = 0;
  for (const c of read.checkIns) {
    const i = slot(c.day);
    if (i < 0) continue;
    sums[i].pct += c.pct; sums[i].n += 1; pctAll += c.pct;
  }
  let done = 0;
  for (const s of read.workouts) {
    const i = slot(s.day);
    if (i < 0) continue;
    sums[i].done += 1; done += 1;
  }
  const n = read.checkIns.length;
  return {
    adherence: n > 0 ? Math.round(pctAll / n) : null,
    checkIns: n,
    adherenceByBucket: sums.map((s) => (s.n > 0 ? Math.round(s.pct / s.n) : null)),
    completions: done,
    completionsByBucket: sums.map((s) => s.done),
  };
}
