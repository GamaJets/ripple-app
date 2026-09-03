// When a coach is seeing this person next — and whether the answer is "never".
//
// ── The field that has never held a value ──────────────────────────────────
//
// `RosterClient.next` (src/lib/trainerMock.ts) is typed `string` and is set to
// the literal `'—'` in all three places src/ui/roster.tsx constructs a client:
// the hand-added page, the linked roster, and the optimistic row for a client
// just added. There is no fourth. Nothing has ever computed it.
//
// It is nevertheless PRINTED. app/(trainer)/client.tsx opens with
//
//     {client.goal} · {mode} · last active {client.lastActive} · next {client.next}
//
// so the client detail screen has always ended its summary line with the word
// "next" and an em dash — a labelled field that looks like a value the app
// could not read, on the screen a coach opens before a session, about the one
// fact they came to find. app/(trainer)/dashboard.tsx draws the same dead field
// on the roster row.
//
// ── And the answer was three lines away ───────────────────────────────────
//
// `buildLedger` in src/lib/sessionCredits.ts already splits every booked
// session for that client into `past` and `upcoming`, sorted, and client.tsx
// already holds the result. It spends `upcoming` on a single figure — "Booked
// Ahead 3" — and never says when any of them is. The next session's timestamp
// is in the component and is rendered nowhere.
//
// Note what `buildLedger` is and is not: it walks every session with
// `status === 'booked'`, whatever pays for it. `route` changes the WORDING of a
// row's state, never whether the row is there. So this answers for a
// pay-as-you-go client exactly as it does for one on a pack.
//
// ── The one sentence this must never produce by accident ──────────────────
//
// "Nothing booked." A coach who reads that rings somebody who is expecting them
// on Thursday, or worse, does not ring somebody who is not. Three separate
// states can all arrive as an empty `upcoming` list and only one of them means
// it:
//
//   · the reads have not landed;
//   · they landed and were refused — `creditRows === null` on that screen;
//   · the client has no account at all, so the reads never ran (`unasked`).
//
// All three are kept apart here and none of them may borrow the fourth's words.
// Same rule as src/ui/loadStatus.ts, arriving on a sentence rather than on a
// figure.
//
// ── An unreadable date is still a booking ─────────────────────────────────
//
// `buildLedger` orders `upcoming` with `Date.parse(a) - Date.parse(b)`, which
// is NaN for a row whose timestamp will not parse — so such a row can land
// anywhere in that list, including first. Taking `upcoming[0]` on trust would
// therefore print "next —" again, from a list that has a perfectly good
// Thursday in it. So the earliest is found here by scanning, and a client whose
// bookings ALL have unreadable dates is told there is something booked and that
// the date could not be read. What must never happen is that a session in the
// diary is reported as no session at all.
//
// Pure and framework-free, and no date is formatted here: `startsAt` is handed
// back exactly as the row carried it, for the screen's own formatter to render
// in the reader's language — same rule as src/lib/registerGaps.ts.
import type { Ledger } from './sessionCredits';

/** What can be said about the diary for one client. */
export type DiaryState =
  /** No account, so nothing was ever asked. Not an empty diary. */
  | 'unasked'
  /** Still reading. */
  | 'loading'
  /** The read was refused. NOT an empty diary. */
  | 'unread'
  /** Read, and there is nothing ahead. */
  | 'none'
  /** Read, and there is something ahead. */
  | 'booked';

export interface NextUp {
  state: DiaryState;
  /**
   * The next booked session's timestamp, exactly as the row carried it, or
   * null. Null under 'booked' means there ARE bookings and none of them has a
   * date this build can read — which is a different sentence from no bookings.
   */
  startsAt: string | null;
  /** So the screen can open that session, or null. */
  sessionId: string | null;
  /** How many more are booked after that one. Zero under every other state. */
  after: number;
}

/** What the coach's screen may say about the diary it has already read. */
export function nextUp(o: {
  ledger: Ledger | null;
  loading: boolean;
  unread: boolean;
  unasked: boolean;
}): NextUp {
  const nothing = { startsAt: null, sessionId: null, after: 0 };
  // Order matters and it is the order of what is KNOWN. A client with no
  // account is not a client whose read failed, and neither is a diary.
  if (o.unasked) return { state: 'unasked', ...nothing };
  if (o.loading) return { state: 'loading', ...nothing };
  if (o.unread || o.ledger == null) return { state: 'unread', ...nothing };

  const rows = o.ledger.upcoming;
  if (rows.length === 0) return { state: 'none', ...nothing };

  // The earliest by scan rather than by trusting position 0 — see the header.
  //
  // What is NOT done here is a second opinion about which sessions are ahead.
  // `buildLedger` split `past` from `upcoming` against its own clock and this
  // takes that split as given: two modules with two ideas of when a session
  // stops being upcoming is how one screen comes to say "next Thursday" while
  // the count beside it says none. Keeping that clock current is the caller's
  // job, and app/(trainer)/client.tsx passes it a live one.
  let bestAt = Infinity;
  let best: { startsAt: string; sessionId: string } | null = null;
  for (const r of rows) {
    const at = Date.parse(r.startsAt);
    if (!Number.isFinite(at)) continue;
    if (at < bestAt) { bestAt = at; best = { startsAt: r.startsAt, sessionId: r.sessionId }; }
  }
  if (!best) {
    // Something is booked and nothing here can say when. Reported as a booking,
    // because it is one.
    return { state: 'booked', startsAt: null, sessionId: null, after: Math.max(0, rows.length - 1) };
  }
  return {
    state: 'booked',
    startsAt: best.startsAt,
    sessionId: best.sessionId,
    // Every other booking, readable date or not. A coach counting what is in
    // the diary is owed the rows whose dates failed as much as the ones that
    // did not — dropping them would report a lighter week than they have.
    after: rows.length - 1,
  };
}

/**
 * Whether this deserves a mark rather than a line.
 *
 * ONE case: nothing in the diary and hours already paid for. That is a client
 * who has bought sessions and is not using them, which is the shape of every
 * refund request and most of the quiet leaving in this business — and it is a
 * fact rather than a judgement, which is what a warn mark may be spent on.
 *
 * Deliberately NOT "nothing booked" on its own. A coach with online-only
 * clients books nothing for most of their roster, and a permanent orange mark
 * beside twelve people is a mark nobody reads on the day it means something.
 * And deliberately not an unread diary either: a failed read is said in words,
 * because a mark beside "we could not check" reads as a finding.
 */
export function nextUpUrgent(n: NextUp, creditsLeft: number | null): boolean {
  return n.state === 'none' && creditsLeft != null && creditsLeft > 0;
}

/**
 * The sentence, with no date in it.
 *
 * The date is the screen's to render — it is the reader's language and the
 * reader's order, and a month name written here would be in this file's. What
 * this owns is which of the five things is true, and the wording of the four
 * that have no date to show.
 *
 * `who` is the client's name as the screen already resolved it, so an
 * unreadable name is whatever that screen already draws rather than a second
 * opinion about it.
 */
export function nextUpLine(n: NextUp, creditsLeft: number | null, who: string): string {
  switch (n.state) {
    case 'unasked':
      return `${who} has no account, so there is no diary to read. Anything you have arranged with them is between the two of you.`;
    case 'loading':
      return 'Reading what is in the diary…';
    case 'unread':
      // Never "nothing booked". This is the sentence the whole module is
      // shaped around.
      return 'The diary could not be read, so this is not a statement that nothing is booked. Check the calendar before you tell them anything.';
    case 'none':
      if (creditsLeft != null && creditsLeft > 0) {
        return creditsLeft === 1
          ? `Nothing booked, and ${who} has 1 session left to use.`
          : `Nothing booked, and ${who} has ${creditsLeft} sessions left to use.`;
      }
      return 'Nothing booked ahead.';
    case 'booked':
      if (n.startsAt === null) {
        return n.after === 0
          ? 'One session is booked and its date could not be read.'
          : `${n.after + 1} sessions are booked and none of their dates could be read.`;
      }
      return n.after === 0
        ? 'The only one in the diary.'
        : n.after === 1
          ? 'And one more after it.'
          : `And ${n.after} more after it.`;
  }
}
