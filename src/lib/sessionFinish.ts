// Finishing a session: the log and the outcome, as one act with two answers.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// "You can start a session but you can't finish a session and have it marked
// completed and save the information that was logged during the session."
//
// Two halves of one hour, recorded in two places that had never heard of each
// other. app/(trainer)/log-session.tsx wrote `workouts` rows and contained no
// session id anywhere; marking a session delivered happened later and
// elsewhere, on app/(trainer)/sessions.tsx, through `markOutcome`. Nothing
// joined them and nothing closed the session. A coach who wrote up the hour
// still had it sitting in the marking queue holding a settlement up, and a
// coach who cleared the queue had no way to see what was done in the hour they
// had just been paid for.
//
// supabase/parts/890 adds the column. This module is the rest of it: what may
// be finished, what the coach is told before they press, and — the part that
// carries the whole thing — what they are told afterwards.
//
// ══ THE DECISION: is "delivered" automatic on Save, or a separate confirm? ══
//
// Neither, exactly. It is the SAME press, on a control that says out loud what
// it is about to do, and it is reported as two facts rather than one.
//
// The argument, in the order it has to be made:
//
// 1. A SEPARATE CONFIRM IS THE BUG, MOVED ONE SCREEN EARLIER.
//    There is already a separate, later, manual step for marking a session
//    delivered: the "Mark what happened" queue. Its existence is exactly why
//    sessions sit unmarked — and while any of them do, `payrollTotal` refuses
//    to price the period, so nobody gets paid. Adding a second dialog after
//    Save reproduces that step, one screen earlier, and a confirmation raised
//    immediately after an action somebody has just deliberately taken is
//    dismissed rather than read. It would buy the appearance of care and none
//    of it.
//
// 2. BUT SILENT IS NOT AVAILABLE, BECAUSE OF PART 370.
//    `sessions_pack_draw_on_outcome` fires on `outcome = 'completed'` and
//    SPENDS A CREDIT — off the client's coach pack, or off a gym pass, by
//    inserting a `gym_pass_redemptions` row. Where the client held the
//    entitlement that should have paid and every one of them was used up, it
//    stamps `pack_draw_shortfall_at`. That is somebody else's money moving, on
//    a screen whose subject is a list of exercises. A button labelled "Save"
//    must not spend it as a side effect, and the coach must not learn what they
//    did by reading a balance later.
//
// 3. SO THE PRESS IS LABELLED, AND THE CONSEQUENCE IS NAMED ABOVE IT.
//    The control is a switch, on by default, that says the session will be
//    marked delivered; `DELIVERED_MEANS` is the sentence under it and it names
//    the credit. Default ON because a coach who has just typed up an hour has
//    just told us the hour happened — refusing to believe them costs the whole
//    feature. Turned OFF in one tap by a coach who wants the record without the
//    outcome: a session that ran short, one they want to talk to the client
//    about first, or a client who left after twenty minutes. That coach loses
//    nothing — the session stays in the marking queue, which is where it was
//    already going.
//
// 4. THE ENTRIES ARE WRITTEN FIRST, AND A REFUSED LOG SPENDS NOTHING.
//    The entries are twenty minutes of typing that exists nowhere else on
//    earth. The outcome is one tap that can be made again from a queue built
//    for exactly that. So the log goes first, and if the SERVER REFUSES IT the
//    outcome is not attempted at all — see `OutcomeAnswer.'not-attempted'`. A
//    credit spent for a session whose record of what was done was refused is
//    the worst of the four endings, and it is the one nobody would ever find.
//
// 5. NOTHING IS REPORTED FROM WHAT WAS SENT.
//    Two writes, two answers, and `finishReport` never collapses them. Entries
//    in with the outcome refused is a session that looks unrun and a coach who
//    thinks it is closed. An outcome marked with the entries lost is worse: the
//    credit is gone and there is no record of what it bought. Each gets its own
//    sentence, in the same alert, and the sentences say different things.
//
// ── Offline ────────────────────────────────────────────────────────────────
//
// Both writes go through the floor queue (src/lib/floorQueue.ts), so both can
// come back 'unsent' — kept on the phone because nobody answered. Rule 1 there
// governs: a queued write is never reported as saved. A queued outcome is
// therefore never reported as a closed session, and `finishReport` says in as
// many words that to everybody else the session is still waiting on an outcome.
import type { LoadStatus } from '../ui/loadStatus';
import { hasEnded, wasBooked } from './sessionHistory';
import { floorFullLine, keptOfflineLine, refusedLine } from './floorQueue';
import { readCappedByIds } from './cappedByIds';
import { capLimit } from './rowCap';

/* ── 1 · what may be finished ─────────────────────────────────────────────── */

/** The minimum a session row needs for this module to reason about it. Kept
 *  structural rather than importing `PtSession`, so the client-side and
 *  gym-side row shapes can both be passed without a conversion. */
export interface FinishableRow {
  clientId?: string | null;
  startsAt: string;
  durationMin?: number | null;
  /** The SLOT state — available, booked, blocked. Never the delivery result. */
  status?: string | null;
  /** `sessions.outcome`. Null means nobody has said yet. */
  outcome?: string | null;
}

/**
 * Whether "Finish this session" belongs on this row.
 *
 * Four conditions and each of them removes a way of doing harm:
 *
 *   · somebody was BOOKED into it. An open slot that has gone by is not a
 *     session; offering to finish one would invent an hour of coaching.
 *   · its END has passed. `hasEnded` measures the end and not the start, so the
 *     hour a coach is standing in is not offered — marking an in-progress
 *     session delivered draws its credit before it has been earned.
 *   · nobody has marked it yet. A session with an outcome has been decided;
 *     re-marking it from here would re-run part 370's draw logic on a row that
 *     has already paid, and the place to CHANGE a decision is the queue that
 *     also offers the undo.
 *   · there is a client on it. There is nobody to log an hour against
 *     otherwise, and log-session refuses a save with no client for the same
 *     reason.
 */
export function canFinish(row: FinishableRow, now: number = Date.now()): boolean {
  if (!row.clientId) return false;
  if (row.outcome != null && row.outcome !== '') return false;
  return wasBooked(row) && hasEnded(row, now);
}

/**
 * Why this session is not offered a finish, addressed to the coach — or null
 * when it is offered.
 *
 * Said rather than left to be inferred from a missing button. A coach looking
 * for the control on the one row that does not have it should not have to
 * guess which of four reasons applies.
 */
export function finishBlockedNote(row: FinishableRow, now: number = Date.now()): string | null {
  if (canFinish(row, now)) return null;
  if (row.outcome != null && row.outcome !== '') {
    return 'This session already has an outcome recorded, so it is not waiting to be finished. Change it from the list below if it is wrong.';
  }
  if (!row.clientId) {
    return 'Nobody is booked into this hour, so there is nothing to write up and nobody to write it against.';
  }
  if (!hasEnded(row, now)) {
    return 'This session has not finished yet. It can be written up and closed once its time has passed.';
  }
  return 'This hour was never booked, so there is no session here to finish.';
}

/* ── 2 · what the coach is told BEFORE they press ─────────────────────────── */

/**
 * The sentence under the "mark it delivered" switch.
 *
 * It names the credit, which is the whole reason this is a labelled control
 * rather than a silent side effect of Save. See point 2 of the decision above:
 * supabase/parts/370 draws a session off the client's coach pack or gym pass at
 * the moment an outcome of 'completed' is written.
 *
 * "if they are on one" and not a flat claim: a client paying cash, or on a
 * membership that includes PT, holds nothing and nothing is drawn. Stating that
 * a credit WILL come off would be wrong for those clients, and this screen has
 * not read their balance and is in no position to say which they are.
 */
export const DELIVERED_MEANS: string =
  'Marking it delivered takes it off your Mark Sessions queue and counts it as delivered for pay. If this client is on a session pack or a gym pass, one session comes off it now.';

/** The same fact, for a coach who has turned the switch off. */
export const NOT_DELIVERED_MEANS: string =
  'The session stays on your Mark Sessions queue for you to decide later, and nothing comes off the client’s pack yet. What you type here is still saved to their record.';

/** The label on the button that does both. Title case, like every other CTA. */
export function finishCta(markDelivered: boolean, hasSession: boolean): string {
  if (!hasSession) return 'Save Session';
  return markDelivered ? 'Save and Finish Session' : 'Save Without Finishing';
}

/* ── 3 · what they are told AFTERWARDS ────────────────────────────────────── */

/** What the server said about one write. The same three answers
 *  `classifyWrite` produces, named here so this module needs no React. */
export type WriteAnswer = 'stored' | 'refused' | 'unsent';

/**
 * What the LOG write can come back as, which is one more than the server has
 * anything to say about.
 *
 * 'full' is the device refusing to keep it: nobody answered AND
 * src/lib/floorQueue.ts is already holding `FLOOR_CAP` acts, so nothing was
 * kept and nothing is coming. It is its own arm rather than a 'refused' because
 * `refusedLine` says "the server read it and declined", which is false here and
 * points a coach at the wrong thing to do about it — and rather than an
 * 'unsent', which promises a send that will never happen for a queue that
 * refused the write.
 */
export type LogAnswer = WriteAnswer | 'full';

/**
 * What became of the outcome, which has two answers the log does not have.
 *
 * 'not-asked'      the coach turned the switch off, or came here without a
 *                  session. Nothing was attempted and nothing is wrong.
 * 'not-attempted'  the LOG was refused, so the outcome was deliberately not
 *                  offered — see point 4 of the decision. This is the arm that
 *                  guarantees no credit is spent for an hour with no record.
 */
export type OutcomeAnswer = WriteAnswer | 'not-asked' | 'not-attempted';

export interface FinishInput {
  /** What became of the workout entries — the server's three answers, plus the
   *  device having refused to keep them. See `LogAnswer`. */
  entries: LogAnswer;
  /** What the server said about the delivered mark. */
  outcome: OutcomeAnswer;
  /** How many exercises were offered. Used for wording only — never as
   *  evidence that any of them landed. */
  entryCount: number;
  /** The client's first name, or null when it could not be read. */
  first: string | null;
  /** The one cause of a refusal a coach can act on, when the screen knows it.
   *  Passed in rather than guessed at here. */
  refusalCause?: string | null;
}

export interface FinishReport {
  /** The alert's heading. Sentence case, like every other alert in the app. */
  title: string;
  /** One sentence per fact, in the order they matter. The screen joins them. */
  lines: string[];
  /** The SERVER confirmed the entries. Never true for a queued write. */
  logged: boolean;
  /** The SERVER confirmed the outcome. Never true for a queued one. */
  closed: boolean;
  /** Whether the screen may close. False while anything the coach typed exists
   *  only on this screen — a refused log must keep its sets on screen, because
   *  nothing else in this app is holding them. */
  mayLeave: boolean;
}

/** "3 exercises" / "1 exercise". */
function exercises(n: number): string {
  return `${n} exercise${n === 1 ? '' : 's'}`;
}

/**
 * The two answers, as two sentences.
 *
 * Every branch below is reachable and each one is a different thing to have
 * happened to a client's record. The rule the whole function is written to
 * hold: a sentence about the entries never mentions the session's state, and a
 * sentence about the session never implies anything about the entries.
 */
export function finishReport(r: FinishInput): FinishReport {
  const who = r.first?.trim() || 'your client';
  const lines: string[] = [];

  const logged = r.entries === 'stored';
  const closed = r.outcome === 'stored';

  /* the log */
  if (r.entries === 'stored') {
    lines.push(`${exercises(r.entryCount)} went into ${who}’s record, marked as logged by you. They will see it on their own phone and it counts towards their progress.`);
  } else if (r.entries === 'full') {
    // Nothing was kept, so the sets are still on this screen and nowhere else —
    // which is why `mayLeave` is false for this arm as it is for a refusal.
    lines.push(floorFullLine('This session'));
  } else if (r.entries === 'refused') {
    lines.push(refusedLine(
      'This session',
      // Two causes, and with a session in hand the second one is new: part 890
      // refuses training filed against a session that is not this person's, or
      // not this coach's to file against. Naming only the roster would send a
      // coach to check a book that is already right.
      r.refusalCause
        ?? 'Two things cause this: the person is not on your roster, or this session is not yours to file training against. If they are on your book, open their record before typing this in again — part of it may have reached them.',
    ));
  } else {
    // The queue's own sentence, verbatim, with the same subject
    // app/(trainer)/log-session.tsx has always used. Not "3 exercises are
    // saved on this phone": the count is what was OFFERED, and a sentence that
    // counts a write nobody answered reads as a receipt for it.
    lines.push(keptOfflineLine('This session'));
  }

  /* the session */
  switch (r.outcome) {
    case 'stored':
      lines.push('This session is now marked as delivered, so it is off your Mark Sessions queue.');
      break;
    case 'refused':
      lines.push('The session was NOT marked as delivered, and that mark is not waiting to send — the server read it and declined. It may no longer be yours to mark. It is still on your Mark Sessions screen.');
      break;
    case 'unsent':
      lines.push('The delivered mark is on this phone and has not reached the server, so to everybody else this session is still waiting on an outcome. It goes up next time this app has signal.');
      break;
    case 'not-attempted':
      lines.push('The session has NOT been marked as delivered, so no session credit has been taken off this client. Nothing about the session has changed.');
      break;
    case 'not-asked':
      // Only worth a sentence when there was a session to leave open. With no
      // session in hand there is nothing to say and nothing was expected.
      break;
  }

  const title = (r.entries === 'refused' || r.entries === 'full')
    ? 'Not saved'
    : r.entries === 'unsent'
      ? 'Kept on this phone'
      : closed
        ? 'Session finished'
        : r.outcome === 'not-asked'
          ? 'Session logged'
          : 'Logged, but not marked delivered';

  // A coach may not walk away from sets that exist only on this screen. That is
  // true of a refusal and equally true of a queue that would not keep them.
  return { title, lines, logged, closed, mayLeave: r.entries !== 'refused' && r.entries !== 'full' };
}

/* ── 4 · what was logged, read back against the session ───────────────────── */

/**
 * The line under a past session saying what was written up in it.
 *
 * Loading, failed and empty are three different sentences, and the failed one
 * is the one that matters: a session whose entries could not be read is not a
 * session nothing was logged in. A coach who reads "nothing was logged" about
 * an hour they wrote up goes and types it a second time, and their client ends
 * up with the same hour of training twice.
 */
export function loggedAgainstLine(status: LoadStatus, count: number | null): string {
  switch (status) {
    case 'loading':
      return 'Reading what was logged in this session…';
    case 'error':
      return 'What was logged in this session could not be read, so this is not a session with nothing in it. Try again when you have signal.';
    case 'partial':
      return count == null
        ? 'More was logged in this session than fitted in one read, so how much is not established.'
        : `More was logged in this session than fitted in one read, so this is at least ${exercises(count)} and not necessarily all of them.`;
    case 'ready':
      if (count == null) return 'What was logged in this session is not established.';
      return count === 0
        ? 'Nothing is filed against this session. Anything written up separately is in the client’s own record and is not joined to this hour.'
        : `${exercises(count)} logged in this session.`;
  }
}

/* ── 5 · the read itself ──────────────────────────────────────────────────── */

type Queryable = { from: (table: string) => any };

/** What came back, and whether it is the whole of it. Never a bare Map: a Map
 *  built from a failed read is an empty Map, and an empty Map says "nothing was
 *  logged" about every session in it. */
export interface SessionLogCounts {
  status: LoadStatus;
  /** Session id → how many `workouts` rows name it. Only meaningful under a
   *  status `isWhole` accepts. */
  bySession: Map<string, number>;
  /** Session id → the movements that were done in it, in the order they were
   *  performed, de-duplicated. A count answers "was it written up"; the names
   *  answer "what did we do", which is the question a coach opening last
   *  Tuesday actually has. */
  namesBySession: Map<string, string[]>;
}

/**
 * How many logged exercises name each of these sessions.
 *
 * Read through `workouts`, which a coach may select for their own clients under
 * `workouts_coach_read` (`is_my_client(user_id)`), and which a client may
 * select for themselves. RLS therefore decides what is counted, and this
 * function does not re-implement it.
 *
 * A failure returns 'error' with an empty map rather than throwing: this is a
 * label under a row on a screen whose subject is payroll, and blacking out a
 * working marking queue because a count could not be read would take away the
 * thing the coach came for. `loggedAgainstLine` is what stops the empty map
 * being rendered as "nothing was logged".
 *
 * ── Why the id list is chunked ─────────────────────────────────────────────
 *
 * `sessionIds` is one id per row on the Mark Sessions screen, and that read is
 * `capLimit()`-bounded — so up to a thousand ids arrive here. A uuid costs
 * about 39 bytes inside a PostgREST `in.("…","…")` list, so a thousand of them
 * is a ~39KB request line against the 8KB nginx and most CDNs enforce by
 * default. Past roughly two hundred ids the proxy refuses the query before the
 * database ever sees it, the refusal is a **414**, supabase-js does not reject
 * on it, and it arrives as `data: null`.
 *
 * `data: null` with no error is the same shape as "nothing is logged against
 * any of these sessions". So a coach at the end of a busy month opened their
 * marking queue and every single session on it read "Nothing is filed against
 * this session" — a sentence about an hour they ran and wrote up, on the screen
 * they use to decide whether it was delivered, with no error anywhere and
 * nothing to pull to refresh into working. `cap` was arguing about the ROW
 * ceiling, which it gets right; the request line is the other limit and nothing
 * was arguing about it at all.
 *
 * `readCappedByIds` and not `readByIds`: the 400-row cap is a deliberate
 * product decision — this is a label under a row, `partial` is a sentence the
 * screen can say, and walking every `workouts` row a thousand sessions have
 * ever collected to write it would make a screen that works slowly wrong. The
 * cap now applies per chunk, which is strictly more rows than before and never
 * fewer, and `truncated` is still carried rather than assumed away.
 */
export async function fetchSessionLogCounts(
  sb: Queryable,
  sessionIds: readonly string[],
  cap = 400,
): Promise<SessionLogCounts> {
  const empty = (status: LoadStatus): SessionLogCounts =>
    ({ status, bySession: new Map(), namesBySession: new Map() });
  const { rows, truncated, error } = await readCappedByIds<{ session_id?: string | null; exercise?: string | null }>(
    sessionIds,
    (chunk) => sb
      .from('workouts')
      .select('id, session_id, exercise, performed_at')
      .in('session_id', chunk)
      // `.order('id')` behind `performed_at` so the rows the cap CUTS are the
      // same ones every time. Two movements logged in the same second are two
      // rows Postgres may return in either order, and at the boundary that
      // decides which of them a coach is shown.
      .order('performed_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(capLimit(cap)),
    { cap },
  );
  if (error) return empty('error');
  const bySession = new Map<string, number>();
  const namesBySession = new Map<string, string[]>();
  for (const row of rows) {
    const id = row.session_id;
    if (!id) continue;
    bySession.set(id, (bySession.get(id) ?? 0) + 1);
    const name = row.exercise?.trim();
    if (!name) continue;
    const seen = namesBySession.get(id);
    if (!seen) namesBySession.set(id, [name]);
    else if (!seen.includes(name)) seen.push(name);
  }
  return { status: truncated ? 'partial' : 'ready', bySession, namesBySession };
}

/**
 * The movements done in a session, as a phrase — or null when there is nothing
 * to name.
 *
 * Capped at three, because this is a line under a row on a list and a coach who
 * ran twelve movements does not want twelve on it. The tail says how many more
 * rather than trailing off, so the phrase is never mistaken for the whole
 * session. Null rather than an empty string for an empty list: the caller
 * withholds the line instead of rendering a sentence with nothing in it.
 */
export function loggedExercisesLine(names: readonly string[], shown = 3): string | null {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (!list.length) return null;
  if (list.length <= shown) {
    return list.length === 1
      ? `${list[0]}.`
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}.`;
  }
  const rest = list.length - shown;
  return `${list.slice(0, shown).join(', ')} and ${rest} more.`;
}
