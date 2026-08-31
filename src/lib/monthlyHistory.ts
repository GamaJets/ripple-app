// The arithmetic behind the monthly trend charts, with no storage in it.
//
// The sibling of src/ui/useMrrHistory.ts, which owns the reads and writes:
// AsyncStorage on the device, `metric_history` on the server (part 129). This
// file holds the part that decides WHICH months are real, and it is pure — no
// supabase, no react-native, no clock of its own — so `npm test` can run it.
//
// ── The one rule this file exists to protect ───────────────────────────────
//
// **A month with no stored snapshot is null. It is never today's figure.**
//
// The version before the hook was written carried the current value backwards
// across every unfilled month, so a fresh install drew a flat six-month line
// labelled Mar–Aug and a gym owner read five months of trading that had never
// happened. Nothing on the chart said those points were invented; a flat line
// is what a steady business looks like.
//
// That failure is not fixed once. It comes back the moment somebody writes a
// `?? current`, a `|| 0` or a `.fill(latest)` anywhere near `seriesFor`, and
// every one of those looks like a tidy-up. So the gap is produced HERE, by one
// function, under a test that puts the bug back and watches it fail.
//
// Moving the history to the server introduced a second way to make the same
// wrong picture, which is why `mergeSnapshots` is here too: a month the server
// has no row for must stay a gap, not fall back to whatever the handset last
// cached for a DIFFERENT month.
//
// ── And a second rule, arriving with the server ────────────────────────────
//
// A failed read is not an empty history. This file cannot enforce that — it
// never sees a network — so the hook carries a LoadStatus and the screens say
// "could not be read" rather than "no history yet". What this file does is
// refuse to invent the values, so that under 'error' there is genuinely nothing
// to print.

/** Month labels, index-aligned with Date#getMonth. */
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One column of the chart: the key it is stored under and the word under it. */
export interface MonthPoint { key: string; label: string }

/** A month's snapshots, keyed 'YYYY-MM'. The shape both stores agree on. */
export type Snapshots = Record<string, number>;

/**
 * The storage key for the calendar month a date falls in, in LOCAL time.
 *
 * Local and not UTC, deliberately and permanently. A coach in Auckland opening
 * the app at 9am on 1 August is in August; `toISOString()` would file that
 * snapshot under July and put it in the wrong column of their own chart. The
 * suite runs under three timezones (`test:zones`) because of this line.
 */
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** True for a well-formed 'YYYY-MM'. The same shape the database check
 *  constraint `metric_history_month_is_ym` enforces, so a key this rejects is
 *  one the server would have rejected anyway. */
export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/**
 * The `count` months ending with the one `now` falls in, oldest first.
 *
 * `new Date(y, m - i, 1)` rather than any month arithmetic of our own: the Date
 * constructor normalises a negative month into the previous year, which is what
 * makes a window starting in the previous December come out right.
 */
export function monthWindow(now: Date, count: number): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: MONTH_LABELS[d.getMonth()] });
  }
  return out;
}

/**
 * The series to plot: one entry per month in the window, null where there is
 * no snapshot for that month.
 *
 * THE NULL IS THE POINT. Do not add a fallback to this function. A month we
 * hold no figure for is a month nobody knows about, and the chart draws it as a
 * gap so that a reader can see the difference between a quiet month and a month
 * that was never recorded. See the header.
 */
export function seriesFor(window: MonthPoint[], snapshots: Snapshots): (number | null)[] {
  return window.map((m) => {
    const v = snapshots[m.key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

/** How many points on the chart are real. The forecast on the owner's revenue
 *  screen divides by this rather than by the window length, which is how a
 *  two-month-old install stops being extrapolated as six months of trading. */
export const recordedCount = (series: (number | null)[]): number =>
  series.filter((v): v is number => v != null).length;

/**
 * Month-on-month change: this month's figure against last month's.
 *
 * 0 when either end is missing — and 0 here means "no comparison", which the
 * screens render as no delta rather than as "unchanged". Preserved exactly as
 * it was before the move to the server: `series[length - 2]` is the previous
 * month's column, and a null at either end produces no claim.
 */
export function historyDelta(series: (number | null)[], currentValue: number | null): number {
  const prev = series[series.length - 2];
  if (prev == null || currentValue == null) return 0;
  return currentValue - prev;
}

/**
 * Anything that came out of a store, reduced to snapshots that can be plotted.
 *
 * Both sources need this. AsyncStorage holds whatever an older build wrote and
 * survives every upgrade; the server holds numeric columns that arrive from
 * PostgREST as strings often enough to matter (`numeric` is not a JS number).
 * A NaN reaching `seriesFor` would be typeof 'number' and would plot as a hole
 * in the line with no explanation, so it is filtered here rather than there.
 *
 * A key that is not 'YYYY-MM' is dropped rather than kept: it can never match a
 * window month, so keeping it would only carry corruption forward on the next
 * write-back.
 */
export function sanitiseSnapshots(raw: unknown): Snapshots {
  const out: Snapshots = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMonthKey(k)) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * The device's cache and the account's history, combined.
 *
 * The server wins where both hold a month, because the server is the account's
 * record and the cache is one handset's memory of it — a coach who corrected a
 * figure on their other phone should see the correction here.
 *
 * The cache is NOT discarded for the months the server has never heard of. Two
 * cases produce those and both matter: a month recorded offline that has not
 * been uploaded yet, and every month recorded by every coach before part 129
 * existed. Dropping them would mean this change ships as an erasure of exactly
 * the history it was written to preserve.
 */
export function mergeSnapshots(local: Snapshots, server: Snapshots): Snapshots {
  return { ...local, ...server };
}

/**
 * The cached months the server does not have — the backfill.
 *
 * Only the ones it has never heard of. A month the server holds is left alone
 * even where the cache disagrees, so a stale handset cannot overwrite the
 * account's record on the strength of being opened.
 */
export function missingOnServer(local: Snapshots, server: Snapshots): Snapshots {
  const out: Snapshots = {};
  for (const [k, v] of Object.entries(local)) {
    if (!(k in server)) out[k] = v;
  }
  return out;
}
