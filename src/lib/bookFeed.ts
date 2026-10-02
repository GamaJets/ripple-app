// What happened across a coach's whole book this week.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// A coach could see two things: a per-client screen, one person at a time, and
// the drift bands on the dashboard, which are an aggregate — "three slipping,
// one at risk". Between a name and a band there was nothing. Nobody could ask
// "what happened this week" and get an answer with people's names in it.
//
// src/lib/activityFeed.ts answers exactly that question for ONE person and is
// imported by the member's own Activity screen and nothing else. This is the
// same question asked by somebody holding forty of them, so the counting is
// reused — `catchUp` — and what is added here is the merge: many clients'
// events into one timeline, newest first, each row carrying whose it is.
//
// ── What it will not do ────────────────────────────────────────────────────
//
// It does not rank, score or decide what matters. A feed that sorts by
// anything other than time is this app telling a coach whose week was more
// important, which it cannot know. Newest first, names attached, and the
// reading is theirs.
//
// It does not fill in people with nothing. A client who did nothing this week
// has no rows here, and that ABSENCE is not drawn as an event — the dashboard's
// drift bands are where "nothing recorded" is already said properly, computed
// over a window long enough to mean it. A quiet week in a seven-day feed is
// not news; a quiet month is, and that is a different screen.
import { catchUp, type CatchUp, type FeedKind } from './activityFeed';
import { num } from './format';

export type { FeedKind };

/** One thing that happened, already attributed to a person. `at` is an ISO
 *  instant as the row carried it; rows whose instant will not read are dropped
 *  rather than placed at the top or bottom of the week. */
export interface BookEvent {
  clientId: string;
  /** The name the roster gave. Never invented: a row whose client the roster
   *  cannot name does not reach this module (see `bookFeed`). */
  name: string;
  kind: FeedKind;
  at: string;
  /** What the row says about itself, if anything — an exercise name, the first
   *  words of a note. Optional because most kinds speak for themselves. */
  detail?: string | null;
}

/** The window every figure on the screen is about. Seven days, because the
 *  question a coach asks on a Monday is about the week behind them. */
export const BOOK_WINDOW_DAYS = 7;

/**
 * The timeline, newest first, bounded.
 *
 * `cap` exists because a book of forty people training four times a week is
 * 160 rows before check-ins, and a screen that draws all of them is a screen
 * nobody scrolls to the end of. The cap is applied AFTER sorting, so what is
 * dropped is the oldest and never an arbitrary slice of one person's week.
 */
export function bookFeed(events: readonly BookEvent[], now: number, cap = 60): BookEvent[] {
  const from = now - BOOK_WINDOW_DAYS * 86_400_000;
  return events
    .filter((e) => {
      const t = Date.parse(e.at);
      // Future rows are refused for `activityFeed`'s reason: nothing that has
      // not happened belongs in a record of what happened, and a row that got
      // there anyway must not inflate the week.
      return Number.isFinite(t) && t >= from && t <= now;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.clientId.localeCompare(b.clientId))
    .slice(0, Math.max(1, Math.trunc(cap)));
}

/** The tally over the same window, counted by the module that already does it
 *  for one person. A PR is not counted twice; see `catchUp`. */
export function bookTally(events: readonly BookEvent[], now: number): CatchUp {
  return catchUp(events, now, BOOK_WINDOW_DAYS);
}

/**
 * How many different people are in the week. The figure a coach actually reads
 * first: "nine of your twelve did something".
 *
 * Takes `now` and windows the events ITSELF rather than trusting the caller to
 * hand it the right list. It used to be called with the output of `bookFeed`,
 * which is capped at 60 rows, while the tally beside it in the same sentence
 * was counted over everything — so a busy book read "190 workouts … from 11 of
 * your 30", two figures measured on different sets. A function that can only
 * be called correctly is a function that will eventually be called wrongly.
 */
export function activePeople(events: readonly BookEvent[], now: number): number {
  const from = now - BOOK_WINDOW_DAYS * 86_400_000;
  const ids = new Set<string>();
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t < from || t > now) continue;
    ids.add(e.clientId);
  }
  return ids.size;
}

/**
 * The line above the feed, or null when there is nothing honest to say.
 *
 * `whole` is whether every read behind it landed. Under anything else this
 * returns the sentence that says so and no figures at all: "4 of 12 trained"
 * computed over a failed read is a claim about eight people who may have done
 * something, and it is exactly the kind of number a coach acts on.
 */
export function bookLine(o: { tally: CatchUp; people: number; onBook: number | null; whole: boolean }): string | null {
  if (!o.whole) {
    return 'Part of this week could not be read, so nothing here is a count of what your clients did.';
  }
  if (o.tally.total === 0) {
    return 'Nothing recorded by anybody in the last seven days. That is what the record holds, not a statement about what they did.';
  }
  const bits: string[] = [];
  const trained = o.tally.workouts + o.tally.prs;
  if (trained > 0) bits.push(`${num(trained)} workout${trained === 1 ? '' : 's'}`);
  if (o.tally.checkins > 0) bits.push(`${num(o.tally.checkins)} check-in${o.tally.checkins === 1 ? '' : 's'}`);
  if (o.tally.prs > 0) bits.push(`${num(o.tally.prs)} personal record${o.tally.prs === 1 ? '' : 's'}`);
  const what = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0] ?? `${num(o.tally.total)} things`;
  // The denominator only when it is known. "9 of your clients" without the
  // total reads as nine of everybody.
  const who = o.onBook != null && o.onBook > 0
    ? `${num(o.people)} of your ${num(o.onBook)}`
    : `${num(o.people)} ${o.people === 1 ? 'person' : 'people'}`;
  return `${what} from ${who} in the last seven days.`;
}
