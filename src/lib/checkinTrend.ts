/**
 * A YEAR OF WEEKLY CHECK-INS, as four lines — the rest of what the member
 * already sent.
 *
 * ── The defect this is the rules half of ─────────────────────────────────
 *
 * `check_ins` carries `energy, sleep, mood, adherence` on every row, rated 1–5,
 * filed once a week by the member, and `app/(client)/checkin.tsx` rendered
 * `ci.latest` and nothing else. Every earlier week was read off the server, held
 * in the provider, and dropped on the floor: the one question a weekly rating
 * exists to answer — is this going up or down — could not be asked by the person
 * who answered it every Sunday. Their coach reads the same rows
 * (src/lib/coachCheckins.ts) and has done all along.
 *
 * ── A 0 is not a rating, and must not be drawn as one ────────────────────
 *
 * The scale starts at 1. `rowToCI` in src/ui/checkins.tsx coerces with
 * `Number(r.energy) || 0`, so a column that came back null, absent or
 * unparseable arrives here as the number 0 — and 0 on a 1–5 chart is not a low
 * score, it is a HOLE that draws as the worst week of somebody's year. Every
 * value outside 1–5 becomes null, which `Spark` renders as a break in the line
 * rather than as a reading (src/ui/kit.tsx says why at length). This is the
 * single load-bearing rule in this file: the difference between "you felt
 * terrible in March" and "March did not record a mood".
 *
 * ── What a truncated read may and may not do ─────────────────────────────
 *
 * Draw, but not count. A capped page is the NEWEST rows and a prefix of an
 * unknown set (src/lib/rowCap.ts), so the lines are real lines over real weeks
 * and "23 check-ins" over them is a wrong number rather than a small one. Same
 * shape `historyBoard` uses in src/lib/programHistory.ts, and for the same
 * reason. An 'error' or a null draws nothing at all: a flat, empty chart under a
 * failed read is a claim about somebody's year.
 *
 * ── Oldest on the left ───────────────────────────────────────────────────
 *
 * The provider holds check-ins newest-first, because that is the order the
 * server is asked for them in and the order `latest` needs. A chart reads the
 * other way, and a series reversed without its labels — or labels reversed
 * without their series — puts every point above the wrong week, which is a chart
 * that renders perfectly and is false. Both come out of this function together,
 * from one pass, so they cannot be reversed apart.
 *
 * Pure and framework-free.
 */
import { dayKeyOf } from './entryEdit';
import { type LoadStatus } from '../ui/loadStatus';

/** One check-in as the provider hands it over (src/ui/checkins.tsx). */
export interface RatingRow {
  id: string;
  at: string;
  energy: number;
  sleep: number;
  mood: number;
  adherence: number;
}

/** Which of the four. The key is the column name, so a reader can go and look. */
export type RatingKey = 'energy' | 'sleep' | 'mood' | 'adherence';

export interface RatingSeries {
  key: RatingKey;
  /** The heading over the line, in the words the form asks the question in. */
  label: string;
  /** Oldest first and parallel to `labels`. Null is a week that recorded no
   *  score for THIS rating — never a zero, never dropped. */
  values: (number | null)[];
  /** How many of the weeks actually carry a reading for it. A line drawn from
   *  one point is a dot, and a caller needs to know before it offers a chart. */
  readings: number;
}

export interface CheckinTrend {
  /**
   * 'unreadable'  the read failed or has not landed. Nothing below is a fact
   *               about this member.
   * 'none'        the read landed and there are no check-ins.
   * 'one'         exactly one. Real, and not a trend: two points is the
   *               smallest thing that can go up or down, and a single reading
   *               drawn as a line would be a flat year invented from a dot.
   * 'some'        there is something to chart.
   */
  state: 'unreadable' | 'none' | 'one' | 'some';
  /** `YYYY-MM-DD` in the reader's own zone, oldest first, one per check-in. */
  labels: string[];
  /** The four, always all four and always in this order, so the screen's
   *  sections do not reorder themselves as the data changes. */
  series: RatingSeries[];
  /** How many check-ins are charted, or null when the read cannot support a
   *  count. Withheld under 'partial' — see the header. */
  charted: number | null;
}

const KEYS: { key: RatingKey; label: string }[] = [
  { key: 'energy', label: 'Energy' },
  { key: 'sleep', label: 'Sleep Quality' },
  { key: 'mood', label: 'Mood' },
  { key: 'adherence', label: 'Plan Adherence' },
];

const EMPTY_SERIES: RatingSeries[] = KEYS.map((k) => ({ ...k, values: [], readings: 0 }));

const UNREADABLE: CheckinTrend = {
  state: 'unreadable', labels: [], series: EMPTY_SERIES, charted: null,
};

/**
 * One rating as a point, or null.
 *
 * The scale is 1–5 and the form refuses to send without all four, so anything
 * outside it did not come from the form: a null column read back as 0, a row
 * repaired by hand, a build that widened the scale. All of them are the same
 * thing to a chart — no reading — and none of them is a bad week.
 */
function score(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

/**
 * The four lines and the week each point sits over.
 *
 * `rows` is the provider's list, NEWEST FIRST, and null under a failure — an
 * empty array must never be able to arrive here meaning both "no check-ins" and
 * "not read", which is the distinction src/ui/loadStatus.ts exists for.
 */
export function checkinTrend(
  rows: readonly RatingRow[] | null | undefined,
  status: LoadStatus,
): CheckinTrend {
  // whole-ok: 'partial' goes on through deliberately. Those weeks are the
  // member's own weeks, each with its own real scores and its own real date,
  // and refusing to draw them because there may be older ones would hide a
  // year to avoid mis-stating its length. The LENGTH is what gets refused
  // instead — `charted` below is `status === 'ready' ? n : null`, and
  // `trendLine` turns that null into "came back at the row limit, so how many
  // there are cannot be counted from here". An `isWhole` on this line would
  // send the member with the longest record down the 'unreadable' path and
  // tell them their check-ins could not be read, which is not what happened.
  if (rows == null || status === 'error' || status === 'loading') return UNREADABLE;

  // Oldest first, and the labels built in the same pass off the same rows. A
  // row whose timestamp will not parse keeps its slot with a null label rather
  // than being dropped: the RATINGS on it are real and are what the chart is
  // about, and deleting the week would shift every later point one place left.
  // `axisLabel` in src/lib/chartAxis.ts already renders an unreadable date as a
  // dash and refuses to invent a neighbouring one.
  const ordered = rows.slice().reverse();
  const labels = ordered.map((r) => dayKeyOf(r.at) ?? '');

  const series: RatingSeries[] = KEYS.map(({ key, label }) => {
    const values = ordered.map((r) => score(r[key]));
    return { key, label, values, readings: values.filter((v) => v != null).length };
  });

  const state = ordered.length === 0 ? 'none' : ordered.length === 1 ? 'one' : 'some';
  return {
    state,
    labels,
    series,
    // A count only over a whole read. Under 'partial' the weeks charted are real
    // weeks; how many there are is not something a prefix of an unknown set can
    // say, and a member told "23 check-ins" who has filed forty is being handed
    // a wrong number rather than a rounded one.
    charted: status === 'ready' ? ordered.length : null,
  };
}

/**
 * The line under the chart heading.
 *
 * Every branch is a different fact about the record. The 'unreadable' one is the
 * branch that matters: an empty chart is indistinguishable from a member who has
 * never checked in, and that is a sentence somebody ACTS on — they conclude the
 * app lost their year and stop filing.
 */
export function trendLine(status: LoadStatus, trend: CheckinTrend): string {
  if (status === 'loading') return 'Reading your earlier check-ins…';
  if (trend.state === 'unreadable') {
    return 'Your earlier check-ins couldn’t be read. That is not the same as never having sent any. Anything you have filed is still on your record.';
  }
  if (trend.state === 'none') return 'Nothing charted yet. Your first check-in starts the record.';
  if (trend.state === 'one') {
    return 'One check-in so far. A second one is what makes a line. Until then there is nothing to compare it against.';
  }
  if (trend.charted == null) {
    return 'Your check-ins came back at the row limit, so how many there are cannot be counted from here. Every week charted is real.';
  }
  return `${trend.charted} check-ins, oldest on the left.`;
}

/**
 * What one line says about itself under its own heading, or null when it has
 * nothing to add.
 *
 * Null is the ordinary case and is why this returns null rather than a cheerful
 * sentence: a member who filled the form in properly every week has four
 * complete lines and needs no commentary on any of them. It speaks up only where
 * a line is BROKEN or too short to draw, both of which are visible on the chart
 * and neither of which explains itself.
 */
export function seriesNote(s: RatingSeries, weeks: number): string | null {
  if (s.readings === 0) {
    return `No week on record carries a ${s.label.toLowerCase()} score, so there is no line to draw. That is a gap in the record, not a run of bad weeks.`;
  }
  if (s.readings === 1) {
    return `Only one week recorded a ${s.label.toLowerCase()} score, so it is drawn as the single point it is.`;
  }
  if (s.readings < weeks) {
    const missing = weeks - s.readings;
    return `${missing} week${missing === 1 ? '' : 's'} recorded no ${s.label.toLowerCase()} score. The break in the line is that week, not a score of nought.`;
  }
  return null;
}
