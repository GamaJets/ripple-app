// One client, summarised for the coach about to open them.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Everything a coach could do with one named person had accreted into a modal
// sheet on the roster, and five per-client screens each added another row to
// it: their checklist, what they are working toward, the week they have
// planned, the photos they sent, the session you ran. A menu of five rows tells
// a coach nothing about which one to open. The screen this module feeds
// (app/(trainer)/client.tsx) puts a summary line under each destination, so the
// way in also says whether there is anything in there.
//
// ── Why the sentences live here and not in the screen ──────────────────────
//
// Because they are where the lying would happen. Each of these lines stands in
// for a whole screen the coach has not opened, which makes it the most
// compressed claim in the app about somebody else's month — and the compression
// is exactly what tempts a zero. "0 photos", "0 open goals", "0 days ticked"
// are all sentences this app can produce from a read that never came back, and
// every one of them is a statement about the client rather than about the
// connection.
//
// So every function below takes the READ STATUS alongside the data and has a
// branch for each: not read yet, refused, truncated, and answered. A truncated
// read is never counted — `capped()` hands back a prefix of an unknown set, so
// the line says "at least" or says nothing at all, never "3". Nothing here
// derives a figure of its own: the goal board is `goalBoard`'s, the week is
// `coachWeek`'s, the photo states are `photoInbox`'s and the tick counts are
// `summariseAdherence`'s. This module only chooses the words.
//
// Pure and dependency-free apart from those modules, so the wording can be
// tested without a database — which matters more here than usual, because a
// wrong sentence on this screen is what decides who a coach rings today.
import { type LoadStatus } from '../ui/loadStatus';
import { type GoalBoard } from './clientGoals';
import { goalLabel, isOverdue, type GoalTarget } from './goalTargets';
import { DAYS_AHEAD, DAYS_BEHIND, type CoachWeek } from './coachWeek';
import { emptyReason, inboxNote, newestSharedFirst, stamp, type Inbox } from './photoInbox';
import { dayLabel } from './adherence';
import { type Drift } from './clientDrift';

/** The span `coachWeek` covers, as a number this file may state out loud. Both
 *  ends come from the constants rather than from a sentence somebody wrote once
 *  and forgot to change when the window moved. */
export const WEEK_SPAN_DAYS = DAYS_BEHIND + DAYS_AHEAD;

const s = (n: number) => (n === 1 ? '' : 's');

/* ── the hero: when this person was last seen at all ───────────────────────── */

/**
 * The line under the "days since anything on record" figure.
 *
 * `drift` null with `failed` false is the read still in flight, which is a
 * third thing and reads as neither a silent client nor a broken connection.
 * When the drift did land, its own `reason` is used verbatim — it is already
 * written about the record rather than about the person, and re-phrasing it
 * here would give a coach two differently-worded verdicts for the same client
 * depending on which screen they were standing on.
 */
export function lastSeenLine(drift: Drift | null, failed: boolean, who: string): string {
  if (failed) {
    return `${who}'s training record could not be read, so this screen cannot say when they were last seen. That is our connection, not their week.`;
  }
  if (!drift) return 'Reading their check-ins, logged workouts, sessions and visits…';
  return drift.reason;
}

/* ── the four destinations ─────────────────────────────────────────────────── */

/**
 * What is worth knowing about their goals without opening them.
 *
 * The three empty states the console named — unreadable, none set, all reached
 * — are kept apart here exactly as `goalBoard` keeps them apart, because a
 * coach acts differently on each: chase the connection, have the conversation,
 * agree the next target.
 */
export function goalsLine(status: LoadStatus, board: GoalBoard, who: string, nowMs: number): string {
  if (status === 'loading') return 'Reading their goals…';
  if (board.state === 'unreadable') {
    return `Their goals could not be read. That is not the same as ${who} having set none.`;
  }
  if (board.state === 'none') {
    return `${who} hasn't set a goal yet — the read came back and it was empty, which makes it worth raising.`;
  }
  if (board.state === 'reached') {
    // A count is safe here even under 'partial': "at least this many reached"
    // is the same good news either way, and the sentence says so.
    const n = board.achieved.length;
    return status === 'partial'
      ? `Everything that came back has been reached — and their goals came back at the row limit, so there may be more.`
      : `All ${n} goal${s(n)} reached. Nothing outstanding, which is usually the moment to set the next one.`;
  }
  const open = board.open.length;
  const nearest = board.open[0];
  const head = status === 'partial'
    ? `At least ${open} open — their goals came back at the row limit, so this is not all of them.`
    : `${open} open.`;
  return `${head} Nearest: ${goalLabel(nearest)}${nearestBy(nearest, nowMs)}.`;
}

/** ' by 12 Sep', ' — target date passed', or nothing. Undated goals get no
 *  invented deadline: `sortGoals` puts them last for the same reason. `nowMs`
 *  is passed in rather than read here so the overdue wording is reproducible in
 *  a test — the same rule `assessDrift` and `projectionOf` already follow. */
function nearestBy(g: GoalTarget, nowMs: number): string {
  if (!g.targetDateISO) return ', with no target date';
  // `dayLabel`, not `stamp`: `goal_targets.target_date` is a bare `date`, and a
  // bare date through Date.parse is UTC midnight — which every local getter
  // reads back a day earlier west of Greenwich. A coach in Los Angeles would be
  // shown a target date one day before the one their client typed. `stamp` is
  // right for `sharedAt` below, which is a real instant. See src/lib/localDate.ts.
  const when = dayLabel(g.targetDateISO);
  if (when === '—') return '';
  return isOverdue(g, nowMs) ? ` — target date passed (${when})` : ` by ${when}`;
}

/**
 * What they have marked in the days around today.
 *
 * Counts the days AHEAD rather than every row in the window: a coach reads this
 * to decide whether to open the week, and what they can still act on is in
 * front of them. Days already gone are on the screen itself, where the reason a
 * session did not happen is worth reading.
 */
export function weekLine(status: LoadStatus, week: CoachWeek, who: string): string {
  if (status === 'loading') return 'Reading the days they have marked…';
  if (week.state === 'unreadable') {
    return `Their planned days could not be read, so this cannot say whether ${who} has marked anything.`;
  }
  if (week.state === 'none') {
    return `${who} has marked nothing in the ${WEEK_SPAN_DAYS} days around today. The read came back empty, so that is about them rather than the connection.`;
  }
  const n = week.ahead.length;
  const head = status === 'partial'
    ? `At least ${n} day${s(n)} marked from today on — the read came back at the row limit.`
    : n === 0
      ? 'Nothing marked from today on; what they marked is already behind them.'
      : `${n} day${s(n)} marked from today on.`;
  const c = week.conflicts.length;
  // A conflict is only ever claimed by `planConflict`, and only where the
  // programme is actually known — a programme that did not come back produces
  // no conflict rather than a silent agreement. See coachWeek.ts.
  return c ? `${head} ${c} disagree${c === 1 ? 's' : ''} with the programme you set.` : head;
}

/**
 * What this client has sent, and — the case that has to survive — whether the
 * question could be asked at all.
 *
 * `failed` and an inbox with no photos are deliberately different sentences.
 * The second is a fact about the client; the first is a fact about the network,
 * and telling a coach their client has sent them nothing on the strength of a
 * refused read is the exact failure src/lib/photoInbox.ts was written against.
 */
export function photosLine(inbox: Inbox | null, failed: boolean, who: string): string {
  if (failed) {
    return `Could not read what they have sent you — which is not the same as ${who} having sent nothing.`;
  }
  const why = emptyReason(inbox);
  if (why === 'unknown') return 'Reading what they have sent you…';
  if (why === 'unlinked') {
    return 'No live coaching link right now, so none of their photos can be read. That is about the link, not about them.';
  }
  if (why === 'none') {
    return `${who} hasn't sent you a progress photo. You see one only when they send it.`;
  }
  const newest = newestSharedFirst(inbox!.photos)[0];
  const when = stamp(newest.sharedAt);
  return when ? `${inboxNote(inbox)} · newest sent ${when}.` : `${inboxNote(inbox)}.`;
}

/**
 * The lines the coach set, and the one thing the ticks can prove on their own.
 *
 * `seen` is `seenDays` and the window length out of `summariseAdherence`, and
 * nothing else: days the client ticked SOMETHING, which is hard evidence they
 * stood in front of their list. Deliberately not a percentage, and deliberately
 * not per line — src/lib/adherence.ts refuses to turn ticks into a score out of
 * a hundred, and a summary row is the last place that rule should be relaxed.
 */
export function listLine(
  itemStatus: LoadStatus,
  activeLines: number | null,
  seen: { seenDays: number; windowDays: number } | null,
  who: string,
): string {
  const lines =
    itemStatus === 'loading' ? 'Reading the lines you have set for them…'
    : itemStatus === 'error' ? 'Your lines for them could not be read, which is not the same as you having set none.'
    : itemStatus === 'partial' ? 'Your lines came back at the row limit, so this is some of them rather than all.'
    : activeLines == null || activeLines === 0 ? `You haven't put a line on ${who}'s list.`
    : `${activeLines} line${s(activeLines)} of yours on their list.`;
  const ticks = seen == null
    ? 'Their ticks could not be read, so there is nothing here about how the month has gone.'
    : seen.seenDays === 0
      ? `Nothing ticked at all in the last ${seen.windowDays} days — a miss and a phone in a drawer look the same from here.`
      : `They ticked something on ${seen.seenDays} of the last ${seen.windowDays} days.`;
  return `${lines} ${ticks}`;
}

/**
 * The programme a coach assigned, or why there is no name to print.
 *
 * A null programme is three situations — none assigned, the read failed, and a
 * programme somebody else assigned, which `assigned_programs_coach_rw` will not
 * show this coach — and only the middle one is about the connection. The status
 * separates the first two; the third is why the "none" branch does not claim
 * the client is training to nothing.
 */
export function programmeLine(
  status: LoadStatus,
  title: string | null,
  days: number | null,
  who: string,
): string {
  if (status === 'loading') return 'Reading what you have assigned them…';
  if (status === 'error') return 'What you have assigned them could not be read.';
  if (!title) return `No programme of yours is assigned to ${who} that this app can read.`;
  return days == null ? title : `${title} · ${days} day${s(days)} a week.`;
}

/* ── what is outstanding, and what could not be checked ────────────────────── */

export interface Attention {
  /** Things a coach can act on now, most-actionable first. */
  items: string[];
  /** Null when everything below was read whole. A sentence naming what was not,
   *  so an empty `items` cannot be read as "nothing outstanding". */
  blind: string | null;
}

export interface AttentionInput {
  who: string;
  /** Unread messages, off the roster row. NULL when the roster itself could not
   *  be read — a count nobody has is not a count of none, and this screen's
   *  whole reason for existing is that the difference gets lost. */
  unread: number | null;
  goalStatus: LoadStatus;
  board: GoalBoard;
  weekStatus: LoadStatus;
  week: CoachWeek;
  /** True when the drift read failed — the record cannot be judged at all. */
  driftFailed: boolean;
  nowMs: number;
}

/**
 * The short list at the top of the client screen.
 *
 * Every item is derived from a read that came back WHOLE. A truncated or
 * refused read contributes nothing to `items` and its name to `blind` instead,
 * because the failure mode this guards against is a clean, empty, reassuring
 * list produced by three reads that never landed — which is the most dangerous
 * screen in the app: it looks like an all-clear and is a blank page.
 */
export function attention(i: AttentionInput): Attention {
  const items: string[] = [];
  const missed: string[] = [];

  if (i.unread == null) missed.push('anything unread from them');
  else if (i.unread > 0) {
    items.push(`${i.unread} unread message${s(i.unread)} from ${i.who}.`);
  }

  if (i.goalStatus === 'error' || i.board.state === 'unreadable') missed.push('their goals');
  else if (i.goalStatus === 'partial') missed.push('the rest of their goals');
  else if (i.board.state === 'working') {
    const late = i.board.open.filter((g) => isOverdue(g, i.nowMs));
    if (late.length) {
      items.push(`${late.length} goal${s(late.length)} past ${late.length === 1 ? 'its' : 'their'} target date, still open.`);
    }
  }

  if (i.weekStatus === 'error' || i.week.state === 'unreadable') missed.push('the days they have marked');
  else if (i.weekStatus === 'partial') missed.push('the rest of the days they have marked');
  else if (i.week.conflicts.length) {
    const c = i.week.conflicts.length;
    items.push(`${c} day${s(c)} they have marked ahead disagree${c === 1 ? 's' : ''} with your programme.`);
  }

  if (i.driftFailed) missed.push('their training record');

  const blind = missed.length
    ? `This list does not account for ${list(missed)} — ${missed.length === 1 ? 'it' : 'they'} could not be read, so it is not a clear one.`
    : null;
  return { items, blind };
}

/** 'a', 'a and b', 'a, b and c'. Written out rather than joined with commas
 *  because this string is read as a sentence, in the middle of one. */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Why nothing on this screen was ASKED for, or null when it was.
 *
 * The third state, and the one that had to be named rather than folded into
 * either of the others. A screen that never issued a read shows the same empty
 * shape as one whose reads are still in flight, and every line function here
 * would say "Reading their goals…" about a read nobody started — which is a
 * promise that something is coming when nothing is. It is not an error either:
 * a client with no account has no rows to refuse.
 */
export function unaskedNote(usingServer: boolean, queryable: boolean, who: string): string | null {
  if (!usingServer) return 'Not read — this build is not talking to a server.';
  if (!queryable) return `Nothing of ${who}'s can be read until they join Repple.`;
  return null;
}

/**
 * Why the server-backed sections of this screen say nothing for a client the
 * coach typed in by hand, or null when the client has an account.
 *
 * A `coach_clients` row has no user behind it, so its id is not a uuid and
 * every read on this screen would be refused by Postgres before RLS ever saw
 * it — see `isQueryableId` in src/lib/clientDrift.ts. Saying so once, in words,
 * is the difference between a screen that is empty because the person is silent
 * and a screen that is empty because there is nobody there to be silent.
 */
export function noAccountNote(queryable: boolean, who: string): string | null {
  return queryable
    ? null
    : `${who} was added by hand and has no Repple account yet, so there are no goals, planned days, ticks or photos of theirs to read. Send them your coaching code and everything below starts filling in.`;
}
