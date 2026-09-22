// What each client has actually got in the diary over the next fortnight.
//
// ── the question a month grid cannot answer ───────────────────────────────
//
// app/(trainer)/calendar.tsx draws a month and a day sheet. Both are organised
// by TIME, so the answer to "what has Priya got booked?" is assembled by a coach
// tapping through fourteen days and remembering. The two things a coach actually
// wants it for — is this person still committed, and have I got room for
// somebody new — are both questions about a PERSON, and the diary is the one
// screen in the app that holds the rows and cannot arrange them that way.
//
// src/lib/rebooking.ts answers the cold half of this already: HAD AN
// APPOINTMENT, HAS NONE. This is the warm half, off the same rows, with no
// second read — who is on the book, and what they have taken.
//
// ── a fortnight, and why not a month ──────────────────────────────────────
//
// Two weeks is the span a coach commits to and can still change. A month ahead
// is mostly standing appointments that have not been confirmed by anybody, so a
// month-long list would be dominated by rows nobody has actually agreed to and
// would read as commitment that is not there. A fortnight is also the horizon
// `REBOOK_LOOKBACK_DAYS` is deliberately NOT — that module explains that a
// fortnight misses the fortnightly client when you are looking BACKWARDS. Looked
// at forwards the asymmetry reverses: a client who trains fortnightly and has
// their next one booked appears here, because the booking exists whether or not
// their rhythm fits the window.
//
// ── the read this is safe over, and the one claim it cannot make ──────────
//
// `useSessions` reads `sessions` newest-first and capped. On a newest-first read
// the cut falls at the OLD end, so the FUTURE half is whole even when the read
// was truncated — the same argument src/lib/rebooking.ts makes at length, and
// the reason `bookedAheadListable` admits 'partial' where most of this codebase
// insists on `isWhole`. What 'partial' costs is history, and this module reads
// no history at all.
//
// What it cannot claim is that somebody with nothing here has nothing booked
// with anybody: these are the coach's own rows. A client may be training with
// another coach in the same gym, and this list says nothing about that.
import type { LoadStatus } from '../ui/loadStatus';

const DAY = 86_400_000;

/**
 * How far ahead "booked out" looks.
 *
 * Named rather than inlined so the heading, the empty line and the arithmetic
 * cannot come to disagree about what the coach is being shown — which is how a
 * section headed "next 14 days" comes to list something three weeks out.
 */
export const BOOKED_AHEAD_DAYS = 14;

/** The minimum this module needs to know about a session row. Deliberately the
 *  same shape `RebookRow` takes, so one list of rows feeds both. */
export interface AheadRow {
  clientId: string | null;
  startsAt: string;
  durationMin: number;
  /** The SLOT state — available, booked, blocked. Never the delivery result. */
  status?: string | null;
  /** `sessions.outcome`. Null means nobody has said what happened. */
  outcome?: string | null;
}

/** One client's fortnight. */
export interface ClientAhead {
  clientId: string;
  /** Every session of theirs inside the window, soonest first. The dates
   *  themselves and not a count, because "three sessions" and "three sessions,
   *  all of them this week" are different answers to the coach's question. */
  startsAt: string[];
}

/**
 * Whether a row is an appointment this client is actually holding.
 *
 * Mirrors `isAppointment` in src/lib/rebooking.ts — an `available` slot belongs
 * to nobody, and a row carrying an outcome is somebody stating it was a real
 * session — and then removes the two outcomes that mean the opposite of a
 * booking. A cancelled session in the future is not something a client has
 * taken; it is a row with a note on it saying they gave it back.
 */
function isHeld(r: AheadRow): boolean {
  if (!r.clientId) return false;
  if (r.outcome === 'cancelled' || r.outcome === 'late_cancelled') return false;
  return r.status === 'booked' || (r.outcome != null && r.outcome !== '');
}

/**
 * What each client has booked between now and `days` from now, soonest client
 * first.
 *
 * A session is "ahead" by its END and not its start, the same line
 * src/lib/rebooking.ts draws: the hour somebody is standing in has not stopped
 * being theirs, and dropping it the instant the clock passes the start time
 * would tell a coach mid-session that their client has nothing on.
 *
 * `nowMs` is passed in. This screen stays mounted for days, and a clock captured
 * in a memo body reports the fortnight that started when the app was opened —
 * the defect src/lib/upcomingWindow.ts was written for.
 */
export function bookedAhead(
  rows: readonly AheadRow[],
  nowMs: number,
  days: number = BOOKED_AHEAD_DAYS,
): ClientAhead[] {
  const until = nowMs + Math.max(1, days) * DAY;
  const byClient = new Map<string, { startMs: number; startsAt: string }[]>();

  for (const r of rows) {
    if (!isHeld(r) || !r.clientId) continue;
    const startMs = Date.parse(r.startsAt);
    if (!Number.isFinite(startMs)) continue;
    const end = startMs + Math.max(0, r.durationMin) * 60_000;
    if (end <= nowMs) continue;
    if (startMs > until) continue;
    const held = byClient.get(r.clientId);
    if (held) held.push({ startMs, startsAt: r.startsAt });
    else byClient.set(r.clientId, [{ startMs, startsAt: r.startsAt }]);
  }

  const out: ClientAhead[] = [];
  for (const [clientId, held] of byClient) {
    held.sort((a, b) => a.startMs - b.startMs);
    out.push({ clientId, startsAt: held.map((h) => h.startsAt) });
  }
  // Soonest first. Whoever the coach sees next is the row they are looking for,
  // and the tie-break is the id rather than the name, so the list cannot
  // reshuffle when a roster read lands.
  return out.sort((a, b) =>
    Date.parse(a.startsAt[0]) - Date.parse(b.startsAt[0])
    || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

/**
 * Whether the list may be shown at all.
 *
 * 'partial' is admitted, for the reason given in the header and argued in full
 * in src/lib/rebooking.ts: this reads only the future, and the future half of a
 * newest-first read is whole even when the read was cut. 'loading' and 'error'
 * produce no list — an empty fortnight is a claim, and under those two nobody
 * has looked.
 */
export function bookedAheadListable(status: LoadStatus): boolean {
  return status === 'ready' || status === 'partial';
}

/** The heading over the list, or null when there is nobody in it. */
export function bookedAheadHeading(n: number, days: number = BOOKED_AHEAD_DAYS): string | null {
  if (n <= 0) return null;
  return n === 1
    ? `One client has something booked in the next ${days} days`
    : `${n} clients have something booked in the next ${days} days`;
}

/**
 * One client's line: how much they have taken, and when.
 *
 * The dates are worded by the caller. Every locale decision in this repo goes
 * through `appLocale()`, and a module that formatted its own would be the
 * fifteenth place that quietly decides what a date looks like.
 *
 * `max` dates are named and the rest become a count, so a standing appointment
 * running twice a week does not turn one row into a paragraph.
 */
export function bookedAheadNote(
  a: ClientAhead,
  when: (iso: string) => string,
  max: number = 4,
): string {
  const n = a.startsAt.length;
  const head = n === 1 ? '1 session' : `${n} sessions`;
  const shown = a.startsAt.slice(0, Math.max(1, max));
  const rest = n - shown.length;
  const dates = shown.map(when).join(', ');
  return rest > 0 ? `${head}: ${dates} and ${rest} more.` : `${head}: ${dates}.`;
}

/** The line when nobody has anything in the window. A real answer, and one a
 *  coach should be told plainly rather than left to read off a blank space. */
export function nobodyBookedAheadLine(days: number = BOOKED_AHEAD_DAYS): string {
  return `Nobody on your book has a session in the next ${days} days.`;
}
