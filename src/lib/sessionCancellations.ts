// The record of a booking that stopped being somebody's — and the four things
// it is NOT allowed to say.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// `public.session_cancellations` (supabase/parts/380) has been written by a
// trigger on every cancellation since the day that part was applied, and until
// this module was written it was read by NOTHING. Both sides were already
// permitted to see it — `session_cancellations_own_r` for the member and
// `session_cancellations_coach_r` for the coach — so the position was that the
// database recorded who cancelled, when, and how close to the hour, and neither
// of the two people it is about could look at any of it.
//
// The gap it closes is named in this repo already. src/lib/sessionHistory.ts
// carries a paragraph headed KNOWN GAP: `cancel_my_session` frees the slot by
// nulling `client_id`, so the session row stops being the member's and their
// own history cannot show it. `CLIENT_CANCELLED_GAP_NOTE` is the sentence that
// admits it on screen. That gap is real and this module does not close it in
// `sessions` — it cannot — but the cancellation itself is recorded elsewhere
// and can now be read from there.
//
// ── The four refusals ──────────────────────────────────────────────────────
//
// A screen built on this data can very easily tell a coach something false
// about a person they are deciding whether to keep a slot for. Each of these is
// a rule with a function or a constant behind it rather than a caution in a
// comment:
//
//  1. NO RATE. EVER. A percentage needs a denominator — the sessions these came
//     out of — and that denominator is not obtainable. The cancelled session is
//     RECYCLED (part 380's own word): `client_id` goes null and the hour is
//     offered to somebody else, so the booking it used to be is not in
//     `sessions` to be counted, and neither is any honest record of how many
//     bookings this pair have ever had. A rate computed over what is left is a
//     wrong number wearing a percentage sign. `NO_RATE_NOTE` says so out loud
//     on both screens and there is no function here that divides.
//
//  2. `cancelled_by` IS A UUID AND MAY BE EITHER OF THEM. Part 380 stores
//     `auth.uid()` at the moment of the write: the member for their own
//     cancellation, the coach for a release, and NULL when neither was signed
//     in — a job, or the service role. "Three cancellations" with nobody named
//     is a coach being told their client is unreliable when the coach may have
//     cancelled two of them. `actorOf` resolves it against the two ids on the
//     row itself, which is the only resolution that needs no second read, and
//     it has a fourth answer — 'unattributed' — that is stated plainly rather
//     than folded into either person.
//
//  3. `was_series` DOES NOT MEAN WHAT ITS NAME SUGGESTS. The trigger writes
//     `old.series_id is not null`, so it records that THIS HOUR belonged to a
//     standing appointment. It is not a count and it does not, on its own, mean
//     several sessions went with one action. What does mean that is set out
//     under `groupActions` below, and it is a stronger test than the flag.
//
//  4. A CANCELLATION IS A FACT ABOUT AN HOUR. Not about a person. Every label
//     in this file is written about the booking — "cancelled 40 minutes before
//     it was due to start" — and none of them grades anybody. This is the same
//     rule src/lib/attendance.ts keeps about an unticked register, for the same
//     reason: the reader is the person having the retention conversation, and
//     they are entitled to the record and not to a verdict.
//
// ── What the record does not contain, said here so screens can say it ──────
//
// · IT STARTS WHEN THE TRIGGER DID. Nothing before part 380 was applied is in
//   this table, and no row can tell you when that was. `RECORD_START_NOTE`.
// · A FAILED WRITE IS SILENT. Part 380's trigger ends in `exception when others
//   then return null`, deliberately, so that a member is never refused a
//   cancellation they are entitled to make because the record of it could not
//   be written. The consequence is that this is a record of what was recorded.
//   `BEST_EFFORT_NOTE`.
// · ENDING A STANDING APPOINTMENT LEAVES NOTHING HERE. `end_session_series`
//   (supabase/parts/143) DELETEs the remaining occurrences; it never updates
//   `client_id`, and the trigger is `after update of client_id`. So a member who
//   ended an arrangement generates no rows at all, and their absence from this
//   page is not evidence they never walked away. `ENDED_SERIES_NOTE`.
// · NO COACH ON THE ROW MEANS NO COACH CAN READ IT. The coach policy is
//   `trainer_id = auth.uid()`, and `trainer_id` is nullable. `COACH_SCOPE_NOTE`.
//
// ── Whose clock, and why there is no day bucket in here ────────────────────
//
// The house rule is that a session's date belongs to the gym's clock where
// there is one. This module obeys it by not having a day bucket at all. Every
// figure it computes is an INTERVAL between two instants — `starts_at` minus
// `cancelled_at` — which is the same number in every zone on earth, so no
// boundary is being drawn on anybody's device. The bands below are intervals
// too: "less than a day before it started" is a fact about a duration, not
// about which calendar day either instant fell on.
//
// The one thing the screens do on the reader's own clock is PRINT the hour that
// was booked, which is what app/(trainer)/client-attendance.tsx and
// app/(client)/pt-sessions.tsx already do for the same rows, and what
// `src/lib/gymWhen.ts` calls the reader's half of the question. A PT session is
// two people in a room and routinely at no gym at all — an independent coach
// has no tenant and therefore no `tenants.timezone` — so there is frequently no
// gym clock to prefer, and inventing one per screen is how this codebase came
// to have three date formats in one console.
//
// Framework-agnostic, like src/lib/attendance.ts and src/lib/memberRecord.ts:
// the Supabase client arrives as an argument, so every rule below is testable
// without a database and the console could read the same record tomorrow.
import { capLimit, capped } from './rowCap';
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

type Queryable = { from: (table: string) => any };

/** A read that either landed or did not. Same shape as src/lib/attendance.ts,
 *  and for the same reason: `{ ok: false }` must not be reachable as an empty
 *  array, because an empty array is what a screen turns into a sentence. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One row of `public.session_cancellations`, in the shape the screens read. */
export interface Cancellation {
  id: string;
  /** The slot, while it still exists. Null once the hour itself was deleted —
   *  `on delete set null`, so that the cancellation outlives the recycling of
   *  the session, which is the whole point of part 380. */
  sessionId: string | null;
  clientId: string;
  /** Nullable on the table. A row with none is invisible to every coach, since
   *  their policy is `trainer_id = auth.uid()`. See `COACH_SCOPE_NOTE`. */
  trainerId: string | null;
  /** The hour that was booked, copied onto the row at cancellation. */
  startsAt: string;
  durationMin: number | null;
  cancelledAt: string;
  /** `auth.uid()` at the moment of the write, or null. NEVER read directly by a
   *  screen — `actorOf` is the only thing allowed to interpret it. */
  cancelledBy: string | null;
  /** The hour belonged to a standing appointment. Read rule 3 in the header
   *  before using this for anything that looks like a count. */
  wasSeries: boolean;
}

/** The set a screen holds, and whether it is all of it. */
export interface CancellationRecord {
  rows: Cancellation[];
  /** True when the read came back at its row cap, so `rows` is a prefix. Every
   *  figure below is then forbidden — see src/ui/loadStatus.ts on 'partial'. */
  truncated: boolean;
}

/* ── 1. who did it ─────────────────────────────────────────────────────────── */

/**
 * Who performed a cancellation, resolved against the row's own two ids.
 *
 * Four answers and not two, and the fourth is the one that matters:
 *
 *   'client'       — `cancelled_by` is the member the booking belonged to.
 *   'coach'        — it is the trainer the hour was with.
 *   'other'        — it is a signed-in account that is neither of them. Gym
 *                    staff releasing a slot from the desk is the live case.
 *                    Named as a third party rather than guessed at, because
 *                    guessing here attributes somebody's action to somebody
 *                    else on the screen where that matters most.
 *   'unattributed' — `cancelled_by` is null. Part 380's own column comment:
 *                    "NULL when neither was signed in, which is a job or the
 *                    service role and is a more useful answer than naming one
 *                    of them by default." This module agrees and does not name
 *                    one of them by default either.
 *
 * Resolved from the row and nothing else. A lookup of the uuid in `profiles`
 * would name the third party, and it is deliberately not done: a client cannot
 * read arbitrary profiles at all (src/lib/threadPeer.ts sets out why), so the
 * member's side of this screen would show a name to nobody and a dash to
 * everybody, and a dash as the SUBJECT of a sentence is what scripts/check-
 * prose.mjs exists to stop.
 */
export type Actor = 'client' | 'coach' | 'other' | 'unattributed';

export function actorOf(c: Cancellation): Actor {
  if (!c.cancelledBy) return 'unattributed';
  if (c.cancelledBy === c.clientId) return 'client';
  if (c.trainerId && c.cancelledBy === c.trainerId) return 'coach';
  return 'other';
}

/** Which of the two people is reading. The words differ because "you" is a
 *  different person on each screen, and a shared string that says "the client"
 *  to the client is how a product comes to sound like a spreadsheet. */
export type Audience = 'coach' | 'member';

/**
 * What to write beside a row about who cancelled it.
 *
 * `who` is the other person's name as the reader knows it, used only on the
 * coach's side. It must be a real word — a name, or a description like "They" —
 * and never a `fig()` dash: this string is running prose and a dash at the head
 * of it reads as the screen having broken.
 *
 * The 'unattributed' sentence is written the long way round on purpose. "Not
 * recorded" beside four rows in a list a coach is skimming reads as a fifth
 * thing the client did; saying that the app does not know who performed it, and
 * that it is not a statement about either of them, is the only version that
 * cannot be misread in the direction it would be misread.
 */
export function actorLine(actor: Actor, audience: Audience, who: string): string {
  if (audience === 'member') {
    switch (actor) {
      case 'client': return 'You cancelled this one.';
      case 'coach': return 'Your coach cancelled this one.';
      case 'other': return 'Somebody else cancelled this one — not you and not your coach. Your gym’s front desk can do this.';
      case 'unattributed': return 'Who cancelled this one was not recorded, so it is not known whether it was you, your coach or the gym.';
    }
  }
  switch (actor) {
    case 'client': return `${who} cancelled this one.`;
    case 'coach': return 'You cancelled this one.';
    case 'other': return `Somebody else cancelled this one — not you and not ${who}. Your gym’s front desk can do this.`;
    case 'unattributed': return `Who cancelled this one was not recorded, so it is not known whether it was you, ${who} or the gym.`;
  }
}

/* ── 2. how much notice ────────────────────────────────────────────────────── */

/**
 * Minutes between the cancellation and the hour it was for.
 *
 * Positive is notice. ZERO OR NEGATIVE IS REAL and is not clamped: a session
 * cancelled after it was due to start is a thing that happens and a floor at
 * zero would render it as "no notice", which is a different and gentler claim
 * than the truth.
 *
 * Null when either instant does not parse. Null is not zero anywhere downstream
 * — `band` answers 'unknown' for it and every tally counts it separately —
 * because a duration we could not compute must never be averaged in as none.
 */
export function noticeMinutes(c: Cancellation): number | null {
  const start = Date.parse(c.startsAt);
  const cancelled = Date.parse(c.cancelledAt);
  if (!Number.isFinite(start) || !Number.isFinite(cancelled)) return null;
  return Math.round((start - cancelled) / 60_000);
}

/**
 * How close to the hour, as a fact about the interval and never as a verdict.
 *
 *   'after'    — cancelled at or after the hour was due to begin.
 *   'under24h' — less than a day of notice.
 *   'over24h'  — a day or more.
 *   'unknown'  — one of the two instants did not parse.
 *
 * THREE BANDS, AND DELIBERATELY NOT THE COACH'S NOTICE WINDOW. This app knows
 * what a late cancellation is: `insideNoticeWindow` in src/lib/booking.ts reads
 * the coach's `CancellationPolicy`, and `charges` records the fee that resulted.
 * Judging a cancellation from March against the policy that is set TODAY is a
 * claim about the past made with a present rule, and a coach who tightened
 * their notice period in June would find last spring retrospectively full of
 * late cancellations. Whether a fee was charged is already answered, once, on
 * the charge record; this module does not answer it a second time and says so.
 */
export type NoticeBand = 'after' | 'under24h' | 'over24h' | 'unknown';

const DAY_MIN = 24 * 60;

export function noticeBand(c: Cancellation): NoticeBand {
  const m = noticeMinutes(c);
  if (m == null) return 'unknown';
  if (m <= 0) return 'after';
  return m < DAY_MIN ? 'under24h' : 'over24h';
}

/** English plural for a unit that is always a small word here. Written out
 *  rather than reached for from a library because it is three lines and the
 *  alternative was a fourth date/duration helper in this repo. */
const unit = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

/**
 * A duration in the largest unit that does not mislead, as plain words.
 *
 * Minutes under an hour, hours under two days, days after that. The rounding is
 * DOWN in every case, because "2 days" for 2 days and 20 hours understates the
 * notice and "3 days" overstates it — and the direction that overstates is the
 * one that flatters whoever cancelled, on a screen the other person is reading.
 *
 * Through `num()` so a four-figure minute count carries its separator, which is
 * what scripts/check-numbers.mjs asks of every figure that can pass a thousand.
 */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return unit(m, 'minute', 'minutes');
  if (m < 2 * DAY_MIN) return unit(Math.floor(m / 60), 'hour', 'hours');
  return unit(Math.floor(m / DAY_MIN), 'day', 'days');
}

/**
 * A notice as the SHORT phrase that goes in a figure slot — "2 days before",
 * "40 minutes after", "on the hour".
 *
 * Separate from `noticeLine` because a tile is not a sentence: it sits under a
 * label that has already said what the number is, and a full sentence in a slot
 * that wide wraps to four lines. Negative is handled here rather than by the
 * caller, because `durationWords` floors at zero and a caller passing it a
 * negative would print "0 minutes before" over a session somebody abandoned.
 */
export function noticeWords(minutes: number): string {
  if (minutes === 0) return 'on the hour';
  return minutes > 0
    ? `${durationWords(minutes)} before`
    : `${durationWords(-minutes)} after`;
}

/**
 * The notice on one row, as the sentence a screen prints.
 *
 * Every branch is a statement about the booking and none is a statement about
 * the person. The 'after' case is the one that would be easiest to write
 * accusingly and is written flattest of all.
 */
export function noticeLine(c: Cancellation): string {
  const m = noticeMinutes(c);
  if (m == null) {
    return 'How much notice this was is not known — one of the two times on the record could not be read.';
  }
  if (m <= 0) {
    return m === 0
      ? 'Cancelled at the hour it was due to start.'
      : `Cancelled ${durationWords(-m)} after it was due to start.`;
  }
  return `Cancelled ${durationWords(m)} before it was due to start.`;
}

/* ── 3. one action, several hours ──────────────────────────────────────────── */

/**
 * The cancellations, grouped into the ACTIONS that produced them.
 *
 * ── Why this is not `was_series` ──────────────────────────────────────────
 *
 * The obvious rule — treat a `was_series` row as part of a batch — is wrong in
 * both directions. A member who cancels ONE occurrence of their standing
 * Tuesday gets a row with `was_series` true, and that is one hour cancelled by
 * one decision; counting it as a fragment of something larger understates it.
 * And nothing stops a batch of non-series rows existing.
 *
 * ── The rule, and why it is exact rather than a tolerance ─────────────────
 *
 * `cancelled_at` defaults to `now()`, and in PostgreSQL `now()` is
 * `transaction_timestamp()` — the instant the TRANSACTION started, identical
 * for every row written inside it. So rows sharing an exact `cancelled_at` and
 * an exact `cancelled_by` were written by one transaction, which is one action
 * by one person.
 *
 * That is not a heuristic and it needs no window. `pause_my_session_series`
 * (supabase/parts/244) is the case it was written for: it calls
 * `cancel_my_session` once per already-booked occurrence in the range, all in
 * one transaction, so a fortnight away produces four rows with byte-identical
 * timestamps. Counting those as four cancellations tells a coach that somebody
 * bailed on them four times for one holiday booked in advance.
 *
 * Two genuinely separate cancellations would have to begin in the same
 * microsecond AND be performed by the same account to be folded together. The
 * grouping is by the raw timestamp STRING rather than a parsed millisecond for
 * exactly that reason: parsing throws away the microseconds Postgres keeps, and
 * a millisecond is wide enough for two taps on a fast connection to land in.
 *
 * Actions come back newest first, and the rows inside each keep the order they
 * arrived in, which is the caller's total order.
 */
export interface CancelAction {
  /** Stable across reloads: it is built from the two values that define it. */
  key: string;
  cancelledAt: string;
  cancelledBy: string | null;
  actor: Actor;
  /** One or more. Length above one is the only evidence in this record that a
   *  single decision removed several hours. */
  rows: Cancellation[];
}

export function groupActions(rows: Cancellation[]): CancelAction[] {
  const out: CancelAction[] = [];
  const index = new Map<string, CancelAction>();
  for (const r of rows) {
    const key = `${r.cancelledAt}|${r.cancelledBy ?? ''}`;
    const found = index.get(key);
    if (found) { found.rows.push(r); continue; }
    const made: CancelAction = {
      key,
      cancelledAt: r.cancelledAt,
      cancelledBy: r.cancelledBy,
      actor: actorOf(r),
      rows: [r],
    };
    index.set(key, made);
    out.push(made);
  }
  return out;
}

/** What a multi-hour action reads as. Singular actions get nothing — a note on
 *  every row is a note nobody reads, the argument `monthCoverageNote` in
 *  src/lib/sessionHistory.ts makes about a boundary. */
export function actionLine(a: CancelAction): string | null {
  if (a.rows.length < 2) return null;
  return `One cancellation, ${num(a.rows.length)} hours — these were removed together, in a single action, `
    + 'and are counted here as one.';
}

/* ── 4. the counts, and the one that does not exist ────────────────────────── */

/**
 * What the record supports counting.
 *
 * `sessions` and `actions` are BOTH here and neither is redundant. A coach
 * planning next month needs to know how many hours went; a coach deciding
 * whether somebody is worth a standing slot needs to know how many times they
 * were let down. Showing only the first overstates it for anybody who has ever
 * paused a standing appointment, and showing only the second understates the
 * hours. So both are shown, side by side, with the difference explained.
 *
 * The `by*` figures are SESSION counts, split by who performed the action, and
 * they are the reason this interface has four of them rather than one. There is
 * no field here that adds them into a single number, because the single number
 * is the one that lies.
 *
 * There is no rate, no percentage and no per-week figure. See `NO_RATE_NOTE`.
 */
export interface CancelTally {
  sessions: number;
  actions: number;
  byClient: number;
  byCoach: number;
  byOther: number;
  unattributed: number;
  /** Hours that belonged to a standing appointment. Rule 3 in the header: this
   *  is a property of the hour, not evidence that several went at once. */
  fromSeries: number;
  after: number;
  under24h: number;
  over24h: number;
  noticeUnknown: number;
  /**
   * The middle notice, in minutes, over the rows whose notice could be read.
   *
   * A median rather than a mean because one cancellation made a month ahead
   * drags an average past every real value in the set, and the number a coach
   * would then read as typical would be one that had never happened. Null when
   * no row has a readable notice — never zero, which is a real and much worse
   * answer.
   */
  medianNoticeMin: number | null;
}

export function tallyCancellations(rows: Cancellation[]): CancelTally {
  const t: CancelTally = {
    sessions: 0, actions: 0,
    byClient: 0, byCoach: 0, byOther: 0, unattributed: 0,
    fromSeries: 0,
    after: 0, under24h: 0, over24h: 0, noticeUnknown: 0,
    medianNoticeMin: null,
  };
  const notices: number[] = [];
  for (const r of rows) {
    t.sessions += 1;
    switch (actorOf(r)) {
      case 'client': t.byClient += 1; break;
      case 'coach': t.byCoach += 1; break;
      case 'other': t.byOther += 1; break;
      case 'unattributed': t.unattributed += 1; break;
    }
    if (r.wasSeries) t.fromSeries += 1;
    switch (noticeBand(r)) {
      case 'after': t.after += 1; break;
      case 'under24h': t.under24h += 1; break;
      case 'over24h': t.over24h += 1; break;
      case 'unknown': t.noticeUnknown += 1; break;
    }
    const m = noticeMinutes(r);
    if (m != null) notices.push(m);
  }
  t.actions = groupActions(rows).length;
  if (notices.length) {
    const sorted = [...notices].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    t.medianNoticeMin = sorted.length % 2
      ? sorted[mid]
      // The mean of the middle pair, floored — the same downward rounding
      // `durationWords` uses, so an even-sized set cannot report more notice
      // than either of the two rows it sits between.
      : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return t;
}

/* ── 5. the sentences ──────────────────────────────────────────────────────── */

/**
 * The refusal, printed on every screen built on this module.
 *
 * It is a constant and not a paragraph in a .tsx file because the pressure to
 * add a percentage here will be constant, and the counter-argument has to be
 * somewhere a person hits before they write the division.
 */
export const NO_RATE_NOTE =
  'There is no cancellation rate on this page and there cannot be one. A rate needs the number of '
  + 'sessions these were cancelled out of, and cancelling hands the hour back — the booking stops '
  + 'being anybody’s and is offered to somebody else — so there is no set left to count them against. '
  + 'What is here is how many, by whom, and how much notice.';

/** Why the list can be shorter than the truth, and never longer. */
export const BEST_EFFORT_NOTE =
  'A cancellation is never refused because the record of it could not be written, so this is a record '
  + 'of what was recorded rather than proof of everything that happened.';

/** Why an empty page is not a claim about anybody's whole history. */
export const RECORD_START_NOTE =
  'This record starts when the app began keeping it. Anything cancelled before that is not here, and '
  + 'its absence is not evidence that it did not happen.';

/** The one exit that produces nothing at all, stated so silence is not read as
 *  a clean record. Verified against supabase/parts/143: `end_session_series`
 *  DELETEs the remaining occurrences and never touches `client_id`, and the
 *  trigger fires on an UPDATE of `client_id`. */
export const ENDED_SERIES_NOTE =
  'Ending a standing appointment is not a cancellation and leaves nothing here — the remaining hours '
  + 'are removed rather than handed back. Somebody who ended an arrangement will not appear on this '
  + 'page for having done so.';

/** What a coach is looking at even on a whole read. The mirror of
 *  `STAFF_RECORD_NOTE` in src/lib/attendance.ts, and true for the same reason:
 *  one coach's record is one coach's record. */
export const COACH_SCOPE_NOTE =
  'Only hours that were booked with you are here. An hour they had with another coach is not, and '
  + 'neither is one where no coach was recorded against the booking.';

/** Said once on each screen, above the figures. Rule 4 in the header. */
export const NOT_A_VERDICT_NOTE =
  'Each of these is a fact about an hour that was booked and then was not. Nothing here is a score.';

/**
 * The one line an empty list is allowed to print, for each of the four states a
 * read can be in.
 *
 * Modelled on `emptyHistoryLine` in src/lib/sessionHistory.ts and carrying the
 * same argument: `[]` means four different things, and only ONE of them may be
 * stated as a fact about somebody's record. The 'error' sentence is the whole
 * reason this function exists — a failed read telling a coach that a client has
 * never cancelled is the app inventing a reassurance, on the screen where it
 * would be acted on.
 */
export function emptyCancellationsLine(
  status: LoadStatus,
  audience: Audience,
): string {
  const whose = audience === 'member' ? 'your' : 'their';
  switch (status) {
    case 'loading':
      return `Still reading ${whose} cancelled sessions.`;
    case 'error':
      return `We could not read ${whose} cancelled sessions, so this is not a record of nothing having `
        + 'been cancelled — it is a read that failed. Pull down to try again.';
    case 'partial':
      return `Only part of ${whose} record could be read, and none of that part is here. There may be `
        + 'more on the server that this screen has not seen.';
    case 'ready':
      return audience === 'member'
        ? 'Nothing on record. No session of yours has been cancelled since this record began.'
        : 'Nothing on record. No session of theirs with you has been cancelled since this record began.';
  }
}

/* ── 6. the read ───────────────────────────────────────────────────────────── */

/**
 * The columns, named once.
 *
 * `tenant_id` is deliberately not selected: nothing on either screen is scoped
 * by gym, both policies key on a person, and a column read and never used is a
 * column somebody later filters on believing it was checked.
 */
const CANCELLATION_COLUMNS =
  'id, session_id, client_id, trainer_id, starts_at, duration_min, cancelled_at, cancelled_by, was_series';

function shape(rows: any[]): Cancellation[] {
  return rows.map((r) => ({
    id: String(r.id),
    sessionId: r.session_id ? String(r.session_id) : null,
    clientId: String(r.client_id),
    trainerId: r.trainer_id ? String(r.trainer_id) : null,
    startsAt: String(r.starts_at),
    // `int` arrives as a number through PostgREST, but Number(null) is 0 and a
    // zero-minute session is a different claim from an unrecorded duration —
    // the same guard `shapeSeries` in src/lib/recurring.ts explains at length.
    durationMin: typeof r.duration_min === 'number' && Number.isFinite(r.duration_min)
      ? r.duration_min : null,
    cancelledAt: String(r.cancelled_at),
    cancelledBy: r.cancelled_by ? String(r.cancelled_by) : null,
    wasSeries: r.was_series === true,
  }));
}

/**
 * The read both sides share.
 *
 * ── The order, and why it has two clauses ────────────────────────────────
 *
 * `.order('cancelled_at', desc).order('id', desc)`. src/lib/rowCap.ts requires
 * a TOTAL order of anything read under a cap, and `cancelled_at` alone is not
 * one — the whole point of `groupActions` above is that a batch shares that
 * value exactly, so a paused fortnight is four rows Postgres may hand back in
 * any order it likes. Without the tie-break the prefix a capped read returns is
 * non-deterministic, and the rows that fell off the end would differ between
 * two consecutive pulls of the same screen.
 *
 * Newest first, so the prefix a capped read keeps is the RECENT end. That is
 * the same choice src/lib/sessionHistory.ts makes and it is what lets a screen
 * name where its knowledge stops.
 */
async function readCancellations(
  sb: Queryable,
  apply: (q: any) => any,
): Promise<Read<CancellationRecord>> {
  try {
    const res = await apply(sb.from('session_cancellations').select(CANCELLATION_COLUMNS))
      .order('cancelled_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (res.error) return { ok: false, reason: res.error.message || 'The read was refused.' };
    const page = capped((res.data as any[]) ?? []);
    return { ok: true, value: { rows: shape(page.rows), truncated: page.truncated } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The read did not complete.' };
  }
}

/**
 * One client's cancellations, read by their coach.
 *
 * BOTH ids are filtered on, and the second is not redundant. RLS on this table
 * is two policies OR'd together — `client_id = auth.uid()` and
 * `trainer_id = auth.uid()` — so a coach who is ALSO somebody's client (this
 * product has trainers who train, see src/lib/ownTraining.ts) reading a screen
 * about a client would otherwise be handed their own cancellations too where
 * the ids happened to line up. Naming `trainer_id` makes the scope on screen —
 * `COACH_SCOPE_NOTE` — the scope in the query.
 */
export function fetchClientCancellations(
  sb: Queryable,
  coachId: string,
  clientId: string,
): Promise<Read<CancellationRecord>> {
  if (!coachId) return Promise.resolve({ ok: false, reason: 'Not signed in.' });
  if (!clientId) return Promise.resolve({ ok: false, reason: 'No client to read.' });
  return readCancellations(sb, (q) => q.eq('trainer_id', coachId).eq('client_id', clientId));
}

/**
 * A member's own cancellations, whoever performed them.
 *
 * Not filtered by coach. A member who changed coaches still cancelled those
 * hours, and a list that dropped them would be the same omission this whole
 * module exists to end — one that nothing on screen could have announced.
 */
export function fetchMyCancellations(
  sb: Queryable,
  clientId: string,
): Promise<Read<CancellationRecord>> {
  if (!clientId) return Promise.resolve({ ok: false, reason: 'Not signed in.' });
  return readCancellations(sb, (q) => q.eq('client_id', clientId));
}
