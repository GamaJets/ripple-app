// The hours in a coach's day that nobody can buy.
//
// ── what a calendar cannot show you ────────────────────────────────────────
//
// A month grid draws what IS in the diary. app/(trainer)/calendar.tsx draws a
// dot per day and a list per day, and both are lists of rows that exist. The
// thing a coach most needs to see is the opposite of a row: the two and a half
// hours between the 9am and the 2pm, on a day they are already at the gym, that
// nothing occupies and NOBODY CAN BOOK.
//
// That last clause is the whole module. An empty hour is not the finding —
// every diary has empty hours and a coach knows where they are. The finding is
// an empty hour that is not for sale. In this product a client books a
// `sessions` row with `status = 'available'`; if no such row covers the hour,
// then no client can take it however free the coach is. supabase/parts/731
// makes that a routine state rather than an exotic one: slot generation skipped
// every availability row with a null timezone, so a coach could have a full
// week of stated working hours and an empty week of bookable ones, with nothing
// anywhere saying so.
//
// So a gap here carries two numbers and they are not the same:
//
//   `minutes`  — how long the free span is.
//   `openMin`  — how much of it an open slot already covers, so a client can
//                take it. `sellableMin` is the rest, and it is the number the
//                coach has never been able to see.
//
// ── what "free" means, exactly ─────────────────────────────────────────────
//
// The same three obstacles the server checks before it will put a booking
// anywhere (`answer_session_request`, supabase/parts/740): a booked one-to-one,
// time the coach blocked out, and a class they are down to teach. Not "the room
// is free" and not "the coach wants to work then" — this module knows neither.
//
// A gap is bounded by the coach's own stated working hours for that weekday.
// Without that bound the answer to "when are you free" is "all night", which is
// true, useless, and would bury the one real finding under sixteen hours of
// noise. A day with no stated hours therefore yields NO gaps and says why,
// rather than inventing a working day on the coach's behalf.
import type { LoadStatus } from '../ui/loadStatus';
import type { WorkWindow } from './moveTimes';

/** Shorter than this is the turnaround between two clients, not a hole in the
 *  day. Thirty minutes is the shortest thing this product sells. */
export const MIN_SELLABLE_MIN = 30;

const MIN = 60_000;

export interface GapBlocker {
  startsAt: string;
  durationMin: number;
}

export interface DayGap {
  startsAt: string;
  startMs: number;
  endMs: number;
  /** How long the whole free span is. */
  minutes: number;
  /** How much of it is already bookable, because an open slot covers it. */
  openMin: number;
  /** The rest: free, inside the coach's working hours, and no client can take
   *  it. The number this module exists to produce. */
  sellableMin: number;
}

export interface DayGapsInput {
  year: number;
  monthIndex: number;
  day: number;
  /** Windows for THIS weekday, from `workWindows` in src/lib/moveTimes.ts.
   *  Empty means the coach has stated none and there are no gaps to report. */
  work: readonly WorkWindow[];
  /** Booked sessions, blocked time and classes. */
  blockers: readonly GapBlocker[];
  /** Hours a client can already take. */
  open: readonly GapBlocker[];
  /** Now, passed in — a screen holding a frozen clock would report this
   *  morning's gaps at four in the afternoon. */
  nowMs: number;
  minMinutes?: number;
}

function spanOf(b: GapBlocker): { s: number; e: number } | null {
  const s = Date.parse(b.startsAt);
  if (!Number.isFinite(s)) return null;
  return { s, e: s + Math.max(0, b.durationMin) * MIN };
}

/** Total minutes of `[s, e)` covered by any of `spans`. Overlapping spans are
 *  counted once — two open slots offering the same 10am are one bookable hour,
 *  not two, and part 86 says so: "only one of them can ever be taken". */
function coveredMinutes(s: number, e: number, spans: readonly { s: number; e: number }[]): number {
  const clipped = spans
    .map((x) => ({ s: Math.max(s, x.s), e: Math.min(e, x.e) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s);
  let total = 0;
  let cur: { s: number; e: number } | null = null;
  for (const x of clipped) {
    if (cur && x.s <= cur.e) { cur.e = Math.max(cur.e, x.e); continue; }
    if (cur) total += cur.e - cur.s;
    cur = { s: x.s, e: x.e };
  }
  if (cur) total += cur.e - cur.s;
  return Math.round(total / MIN);
}

/**
 * The holes in one local day, longest-first.
 *
 * Built from local wall-clock components for the reason `moveTimes` states:
 * "9am on Sunday" is a wall-clock fact and adding milliseconds to a midnight
 * gets it wrong twice a year. Everything after that is instants.
 *
 * Only the part of the day still AHEAD of now is reported. A hole at eight this
 * morning is not a thing a coach can sell at four this afternoon, and listing
 * it turns a working tool into a reproach.
 */
export function dayGaps(input: DayGapsInput): DayGap[] {
  const min = Math.max(1, input.minMinutes ?? MIN_SELLABLE_MIN);
  if (!input.work.length) return [];
  const busy = input.blockers.map(spanOf).filter((x): x is { s: number; e: number } => x != null);
  const open = input.open.map(spanOf).filter((x): x is { s: number; e: number } => x != null);

  const out: DayGap[] = [];
  for (const w of [...input.work].sort((a, b) => a.startMin - b.startMin)) {
    const wStart = new Date(input.year, input.monthIndex, input.day,
      Math.floor(w.startMin / 60), w.startMin % 60, 0, 0).getTime();
    const wEnd = new Date(input.year, input.monthIndex, input.day,
      Math.floor(w.endMin / 60), w.endMin % 60, 0, 0).getTime();
    if (!(wEnd > wStart)) continue;
    // Cuts inside this window, in order. Each busy span closes the run before
    // it and opens the next one after it.
    const inside = busy
      .map((b) => ({ s: Math.max(wStart, b.s), e: Math.min(wEnd, b.e) }))
      .filter((b) => b.e > b.s)
      .sort((a, b) => a.s - b.s);
    let cursor = Math.max(wStart, input.nowMs);
    const edges = [...inside, { s: wEnd, e: wEnd }];
    for (const b of edges) {
      if (b.s > cursor) {
        const s = cursor;
        const e = b.s;
        const minutes = Math.round((e - s) / MIN);
        if (minutes >= min) {
          const openMin = coveredMinutes(s, e, open);
          out.push({
            startsAt: new Date(s).toISOString(),
            startMs: s, endMs: e, minutes, openMin,
            sellableMin: Math.max(0, minutes - openMin),
          });
        }
      }
      cursor = Math.max(cursor, b.e);
    }
  }
  return out.sort((a, b) => b.sellableMin - a.sellableMin || a.startMs - b.startMs);
}

/** The gaps worth telling a coach about: the ones no client can take. */
export function sellableGaps(gaps: readonly DayGap[], minMinutes: number = MIN_SELLABLE_MIN): DayGap[] {
  return gaps.filter((g) => g.sellableMin >= minMinutes);
}

/**
 * Whether the three reads behind a gap support stating one at all.
 *
 * A gap is a claim that NOTHING is in an hour, which is the one shape of claim
 * an incomplete read cannot support: the missing row is exactly the booking
 * that occupies it. So this is `isWhole` on all three, and a screen that cannot
 * satisfy it says nothing rather than something qualified — a coach who offers
 * a client an hour they are already teaching in has been actively misled, which
 * is worse than not having the feature.
 */
export function gapsAreKnown(sessions: LoadStatus, classes: LoadStatus, avail: LoadStatus): boolean {
  return sessions === 'ready' && classes === 'ready' && avail === 'ready';
}

/** Why no gaps are being shown, or null when they are. One sentence per cause,
 *  because the next step differs for each and "something is missing" leaves the
 *  coach unable to tell which. */
export function gapsUnknownNote(sessions: LoadStatus, classes: LoadStatus, avail: LoadStatus): string | null {
  if (gapsAreKnown(sessions, classes, avail)) return null;
  if (sessions === 'loading' || classes === 'loading' || avail === 'loading') {
    return 'Still reading your day.';
  }
  if (sessions === 'error' || classes === 'error' || avail === 'error') {
    return 'Your day could not be read in full, so the free hours in it are not known. This is a read that '
      + 'failed, not an empty day. Pull down to try again.';
  }
  return 'Only part of your day came back, so the free hours in it are not established. An hour that looks '
    + 'free here may already have something in it. Pull down to refresh.';
}

/**
 * How to say a length of time to a coach.
 *
 * Minutes under an hour, hours and minutes above it. No locale decision is made
 * here — these are a number and a unit symbol, which is the one thing
 * src/lib/format.ts does not own.
 */
export function gapLengthLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}min`;
}

/**
 * The line under a gap.
 *
 * Two states, and the difference between them is the point of the feature. A
 * gap partly covered by an open slot is partly for sale already; a gap covered
 * by nothing is time the coach is keeping free that no client can reach. The
 * second sentence says what to do about it in the app's own vocabulary — Add a
 * Session and Weekly Availability are the two controls on this screen that
 * create bookable hours.
 */
export function gapNote(g: DayGap): string {
  if (g.openMin <= 0) {
    return 'Nobody can book this — there is no open slot across it. Add a session or open the hour so a client can take it.';
  }
  return `${gapLengthLabel(g.openMin)} of this is already open for booking; the rest of it nobody can take.`;
}

/** The heading over the list, or null when there is nothing to head. Counts
 *  only what was actually established — the caller has already gated on
 *  `gapsAreKnown`, and this counts the list it was given. */
export function gapsHeading(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? 'An hour nobody can book' : `${n} stretches nobody can book`;
}
