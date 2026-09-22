// What a coach may be told about the sleep and water their client typed in.
//
// ── The three answers that are not one answer ──────────────────────────────
//
// A coach's screen showing nothing has three possible causes and they mean
// opposite things:
//
//   · the member has not turned sharing on. There may be a fortnight of nights
//     sitting in their app and it is not the coach's to see. The screen says
//     so, and says NOTHING about whether any exist — "they have not logged any"
//     would be a claim about data this account was never entitled to read.
//   · sharing is on and the window is empty. Genuinely nothing recorded, and
//     the only one of the three a coach may act on.
//   · the read failed. Unknown. Not "nothing recorded", not "not shared" — and
//     never rendered as a zero.
//
// The gate is in the database (supabase/parts/2670), which is what makes the
// first of those true rather than merely displayed. This module only decides
// which sentence is honest, and it is pure so that the decision can be tested
// without a screen, a network or a coach.
//
// ── The fourth, which the glucose screen had to learn ──────────────────────
//
// 'partial' is a read that FINISHED and came back at PostgREST's row ceiling
// (src/lib/rowCap.ts). The rows are real; the SET is a prefix. So it is neither
// 'ready' nor 'error': the list may be shown and an average over it may not,
// because that average is arithmetic over an unknown fraction of somebody's
// history presented as their average. `isWhole` is the gate for every figure
// here, exactly as src/ui/loadStatus.ts asks — never `!== 'error'`.
//
// ── Dating a night ────────────────────────────────────────────────────────
//
// `sleep_logs.at` is a timestamptz — an instant — and the local calendar night
// an instant belongs to is `nightKey` (src/lib/sleepMerge.ts), which is the
// convention every sleep reader in this codebase already uses. It is NOT
// `at.slice(0, 10)`: that is the UTC day, and west of Greenwich it files a
// night under the wrong date every time the clock crosses midnight UTC.
//
// `hydration_logs.logged_on` is a bare `YYYY-MM-DD` — a date, with no instant
// attached — computed on the member's own device. It is therefore compared and
// sorted AS A STRING here and never handed to `Date.parse`, which would resolve
// it to UTC midnight and move it a day for most of the world. See
// src/lib/localDate.ts; rendering it as a date is that module's job, at the
// edge, and not this one's.
//
// One honest limit, written down rather than hidden: `nightKey` reads the
// instant in the READER's timezone, so a coach working in a different zone from
// their client can see a night attributed to the neighbouring day. That is the
// existing convention for every screen in this app that dates a typed night,
// and a second convention living only on the coach's side would be worse — two
// screens disagreeing about which night a number belongs to is the class of bug
// src/lib/sleepMerge.ts exists to end.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import { nightKey } from './sleepMerge';

/** A `sleep_logs` row as the coach's read asks for it. */
export interface SleepLogRow {
  at: string;
  hours: number;
  quality: number;
}

/** A `hydration_logs` row. `loggedOn` is the member's own local calendar day. */
export interface WaterLogRow {
  loggedOn: string;
  glasses: number;
}

/** One night, with every entry the member filed for it, newest night first. */
export interface WellnessNight {
  /** `YYYY-MM-DD`, from `nightKey`. */
  night: string;
  /** More than one is possible and they are NOT averaged — see below. */
  entries: { hours: number; quality: number }[];
}

/**
 * What the coach's panel is allowed to draw.
 *
 * A discriminated union rather than a bag of booleans, because the states are
 * mutually exclusive and the screen must be unable to render two of them —
 * "not shared" beside an empty list is the exact sentence pair this exists to
 * make impossible.
 */
export type WellnessPanel =
  /** No account behind this client (a coach typed them in), so nothing was
   *  ever asked and nothing was ever refused. */
  | { kind: 'not-asked' }
  /** A read is still in flight. Nothing is known yet. */
  | { kind: 'loading' }
  /** The consent flag or the logs could not be read. UNKNOWN, not empty. */
  | { kind: 'unreadable' }
  /** The member has not turned it on. Says nothing about what they have. */
  | { kind: 'not-shared' }
  /** Shared, and here is what came back. `whole` is false when the read was
   *  truncated, and no figure may be computed over it. */
  | { kind: 'shared'; nights: WellnessNight[]; water: WaterLogRow[]; nightsWhole: boolean; waterWhole: boolean };

export interface PanelInput {
  /** False for a hand-added client with no user account. See clientRecord.ts. */
  askable: boolean;
  /** The consent flag. `null` is "could not be read", never "off". */
  shared: boolean | null;
  /** Status of the `clients.wellness_shared` read. */
  flagStatus: LoadStatus;
  sleepStatus: LoadStatus;
  waterStatus: LoadStatus;
  sleep: SleepLogRow[];
  water: WaterLogRow[];
}

/**
 * Which of the five things is true, in the one order that cannot lie.
 *
 * The order is the whole content of this function:
 *
 *   1. not-asked outranks everything. A client with no account has no `clients`
 *      row, so the flag read comes back as NO ROW — which is indistinguishable
 *      from a refusal at the wire. Reporting that as "their sleep could not be
 *      read" tells a coach a read failed when no such read was ever entitled to
 *      run. This is the bug app/(trainer)/client.tsx carries a note about on
 *      exactly this shape of panel.
 *   2. loading before any verdict, so an in-flight read never prints as an
 *      answer.
 *   3. unreadable before not-shared. `shared === null` means we do not know
 *      what the member chose, and printing "they have not shared" would be
 *      asserting their decision from our own failure.
 *   4. not-shared before anything about rows. Under this verdict the rows are
 *      not carried at all — RLS returns none, and a panel holding an empty list
 *      it might print "nothing logged" from is a panel one edit away from
 *      saying it.
 *   5. shared, with whether each read was whole.
 */
export function wellnessPanel(i: PanelInput): WellnessPanel {
  if (!i.askable) return { kind: 'not-asked' };
  if (i.flagStatus === 'loading') return { kind: 'loading' };
  if (i.flagStatus === 'error' || i.shared == null) return { kind: 'unreadable' };
  if (!i.shared) return { kind: 'not-shared' };
  if (i.sleepStatus === 'loading' || i.waterStatus === 'loading') return { kind: 'loading' };
  // Both failing and one failing are the same verdict for the panel as a whole
  // only if they are reported together, and they are not: each half prints its
  // own sentence below. What is refused here is a panel that claims to be
  // showing a shared record when NEITHER half arrived.
  if (i.sleepStatus === 'error' && i.waterStatus === 'error') return { kind: 'unreadable' };
  return {
    kind: 'shared',
    nights: nightsOf(i.sleep),
    water: sortedWater(i.water),
    nightsWhole: isWhole(i.sleepStatus),
    waterWhole: isWhole(i.waterStatus),
  };
}

/**
 * Rows into nights, newest first, WITHOUT averaging a night that has two.
 *
 * `sleep_logs` is a log and not a per-day answer — part 109 says so on the
 * table — and a member who files twice for one night has reported two things.
 * Averaging them produces a figure nobody typed, which is the move
 * src/lib/readiness.ts spends a paragraph refusing to make and is not going to
 * be made here for the coach's benefit.
 *
 * A row whose `at` is unreadable is dropped rather than filed under a guess. It
 * is not counted as a night and not counted as zero.
 */
export function nightsOf(rows: SleepLogRow[]): WellnessNight[] {
  const by = new Map<string, { hours: number; quality: number }[]>();
  for (const r of rows) {
    const night = nightKey(r.at);
    if (!night) continue;
    const hours = Number(r.hours);
    const quality = Number(r.quality);
    if (!isFinite(hours) || !isFinite(quality)) continue;
    const list = by.get(night) ?? [];
    list.push({ hours, quality });
    by.set(night, list);
  }
  // String compare, descending. These are `YYYY-MM-DD` and nothing else, so
  // lexical order IS chronological order — and no Date is constructed, which is
  // the only way to sort dates without a timezone getting a vote.
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([night, entries]) => ({ night, entries }));
}

/** Water days newest first, by string compare on the bare date. */
export function sortedWater(rows: WaterLogRow[]): WaterLogRow[] {
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.loggedOn)) && isFinite(Number(r.glasses)))
    .slice()
    .sort((a, b) => (a.loggedOn < b.loggedOn ? 1 : a.loggedOn > b.loggedOn ? -1 : 0));
}

/**
 * The average hours across the nights on screen, or null.
 *
 * Null — not zero, and not a number — whenever the set is not known to be
 * whole, and whenever there is nothing to average. A dash is the house answer
 * to an unknown figure; a zero would read as "they slept no hours", which about
 * a person is a claim nobody has any business making.
 *
 * Every entry counts, including the second one filed for the same night: the
 * average is over what the member reported, not over nights.
 */
export function averageHours(nights: WellnessNight[], whole: boolean): number | null {
  if (!whole) return null;
  const all = nights.flatMap((n) => n.entries);
  if (!all.length) return null;
  const total = all.reduce((a, e) => a + e.hours, 0);
  return total / all.length;
}

/**
 * The average glasses across the days that HAVE a row, or null.
 *
 * Days with no row are not days with no water. `hydration_logs` has a row only
 * once a member has touched the counter, so a member who drank and never opened
 * the app has no row — and dividing by "days in the window" would quietly
 * report every one of those as a zero. The divisor is the number of days
 * recorded, and the count is printed beside the figure so a coach can see how
 * thin it is.
 *
 * A stored 0 IS counted: part 109 allows zero deliberately, because a member
 * pressing minus back down to nothing is a real answer and is not the same as
 * having no row.
 */
export function averageGlasses(days: WaterLogRow[], whole: boolean): number | null {
  if (!whole) return null;
  if (!days.length) return null;
  return days.reduce((a, d) => a + Number(d.glasses), 0) / days.length;
}

/** The 1–5 picker, as marks. Never zero marks for a night that has a quality. */
export function qualityMarks(quality: number): string {
  const q = Math.max(1, Math.min(5, Math.round(quality)));
  return '●'.repeat(q) + '○'.repeat(5 - q);
}

/* ── The sentences ────────────────────────────────────────────────────────
 *
 * Kept here, beside the states they belong to, so that the screen cannot pair
 * the wrong one with the wrong verdict and so that a test can read them.
 *
 * Each takes a VOICE rather than a name. A coach is reading about somebody
 * else, and the difference between the member's own screen and this one is in
 * the verb as well as the pronoun — which is why the parts are carried
 * separately and never assembled by dropping a name into a fixed sentence. A
 * name we do not have falls back to third-person plural, and the reason that
 * matters is on the record: this screen used to say "They has never been
 * scanned". Structurally identical to `HistoryVoice` (src/ui/ExerciseHistory),
 * which is where the coach screens already get it from; it is restated here so
 * that this module stays pure and testable under plain node.
 */
export interface Voice {
  /** "Sam", or "They". */
  they: string;
  /** "Sam's", or "their". */
  their: string;
  /** "has", or "have". */
  have: string;
}

/** What to say when the member has not turned it on. Says nothing about what
 *  they have — that is the half a coach is not entitled to infer. */
export const notSharedLine = (v: Voice): string =>
  `${v.they} ${v.have} not shared their sleep and water logs. Whether there are any is not ` +
  'something this screen can tell you. It is theirs to change, in their own app, under ' +
  'Watch & Devices.';

/** What to say when the read failed. Never "there are none". */
export const unreadableLine = (v: Voice): string =>
  `Whether ${v.they} ${v.have} shared their sleep and water, and what is in it, could not be read ` +
  'just now. This is not a statement that there is nothing.';

/** What to say for a client the coach typed in by hand. */
export const notAskedLine = (v: Voice): string =>
  `${v.they} ${v.have} no account in this app, so there is nothing to share and nothing was asked.`;

/** Shared, read whole, and empty. The only one of these a coach may act on. */
export const nothingLoggedLine = (v: Voice): string =>
  `${v.they} ${v.have} shared these, and ${v.have} logged nothing in the last two weeks.`;

/** Shared, and the read came back at the ceiling. */
export const truncatedLine = (what: string): string =>
  `More ${what} on record than can be read at once, so what is below is the most recent of ` +
  'them and no average over it would be their average.';
