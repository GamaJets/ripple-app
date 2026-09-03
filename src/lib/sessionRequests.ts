// Asking for an hour the coach never opened — and the five different things
// that can then be true of it.
//
// ── Why this module exists at all ─────────────────────────────────────────
//
// A client sees GENERATED OPEN SLOTS: real `sessions` rows with
// `status = 'available'`, published by their coach, booked through
// `book_session`. They have never been shown a coach's weekly availability and
// they are not going to be — that table is coach-side by design. So until now a
// member whose coach had not published Tuesday at seven had nothing to tap, and
// the product owner's report said exactly that: "not able to book a session or
// send a request for a booking".
//
// `supabase/parts/740-a-time-the-coach-had-not-opened.sql` is the other half of
// this file and carries the reasoning for the schema. This is the part the apps
// need and the part that can be asserted with no database: what a request IS,
// what has become of one, and what a person is told about it.
//
// ── THE RULE THIS WHOLE FILE PROTECTS ─────────────────────────────────────
//
// A request is not a booking. Nobody has agreed to anything, no hour is held,
// no credit has moved, and the member must never be able to read one as though
// somebody had. That is not a copy preference — it is the failure this feature
// can actually cause: a member who reads "Tuesday 7pm" on their own screen and
// arranges their evening around a question nobody has answered.
//
// So there is no shared sentence. `outcomeLine` writes a DIFFERENT sentence for
// every outcome, `askedLine` never uses the word booked, `NOT_A_BOOKING` is
// printed on the screen where the asking happens, and the test asserts the
// words that must not appear in the ones that are not bookings.
//
// ── The outcome is five things, and only four of them are stored ──────────
//
// `state` in the database is asked | accepted | declined | withdrawn. The fifth
// is EXPIRED and it is computed here, from the hour the request asks for.
//
// The rule, stated once: A REQUEST EXPIRES WHEN THE HOUR IT ASKS FOR ARRIVES,
// and not before. A question about a specific hour is answered by that hour
// passing. A fixed timer — 48 hours, a week — would kill a request made three
// weeks out while it was still perfectly live, and would leave one made for
// tomorrow morning standing after the morning had gone.
//
// Computing it rather than storing it is the deliberate half. A stored expiry
// needs a job, and a job that quietly stops running is precisely how the defect
// beside this one happened: `run_open_slot_extension` skipped every coach with
// no timezone, reported a count nobody read, and produced a client app with
// nothing in it and no error anywhere (supabase/parts/731). Derived, the rule is
// true at every instant with nothing scheduled and reads the same to the
// member's screen, the coach's screen and the RPC that refuses to accept a
// lapsed one.
//
// `EXPIRY_RULE` is that sentence for a member, and the screen prints it where
// they ask rather than where they find out.
//
// ── Money is not in this file, and that is the design ─────────────────────
//
// There is no price here, no credit, no fee and no currency. A question costs
// nothing. An ACCEPTED request becomes a `sessions` row and is paid for by the
// route that already exists: part 740 leaves `booking_drew_credit_at` null, so
// part 370's delivery draw treats it exactly as it treats a session a coach
// books into their own diary. There is no second path and this module would be
// the wrong place to build one.
//
// Pure — no React, no Supabase, no clock of its own. Every function that needs
// "now" is given it, so the whole of it is assertable under `npm test`.
import { overlaps, type BusySpan } from './booking';

/* ── what one is ───────────────────────────────────────────────────────── */

/** The four states the database stores. 'expired' is not among them on
 *  purpose — see `outcomeOf`. */
export type RequestState = 'asked' | 'accepted' | 'declined' | 'withdrawn';

/** What is actually true of a request, which is the stored state plus the one
 *  the clock decides. */
export type RequestOutcome = RequestState | 'expired';

export interface SessionRequest {
  id: string;
  clientId: string;
  trainerId: string;
  /** The instant asked for. */
  startsAt: string;
  durationMin: number;
  /** The member's own words, or null. */
  note: string | null;
  state: RequestState;
  /** The session acceptance created, where there is one. */
  sessionId: string | null;
  /** The coach's words on a decline, or null — a coach who declines without
   *  explaining has still given an answer. */
  declineNote: string | null;
  answeredAt: string | null;
  createdAt: string;
}

/** A row as PostgREST hands it over. Every field optional: this shape crosses
 *  the wire and a build that has not taken part 740 reads nothing at all. */
export interface RawSessionRequest {
  id?: unknown;
  client_id?: unknown;
  trainer_id?: unknown;
  starts_at?: unknown;
  duration_min?: unknown;
  note?: unknown;
  state?: unknown;
  session_id?: unknown;
  decline_note?: unknown;
  answered_at?: unknown;
  created_at?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * A stored state this build recognises, or null.
 *
 * Null rather than a default, and the callers below turn null into 'asked'
 * ONLY where a row exists at all. The value that must never be invented is
 * 'accepted': reading a state this build has never heard of as an acceptance
 * would tell a member their coach had said yes on the strength of a string.
 */
export const asRequestState = (v: unknown): RequestState | null =>
  v === 'asked' || v === 'accepted' || v === 'declined' || v === 'withdrawn' ? v : null;

/**
 * Rows in, requests out. Anything without an id and an hour is dropped: there
 * is no sentence to write about a request that cannot say when it is for.
 */
export function shapeRequests(rows: readonly RawSessionRequest[] | null | undefined): SessionRequest[] {
  if (!rows) return [];
  const out: SessionRequest[] = [];
  for (const r of rows) {
    const id = str(r.id);
    const startsAt = str(r.starts_at);
    if (!id || !startsAt || !Number.isFinite(Date.parse(startsAt))) continue;
    const dur = typeof r.duration_min === 'number' && r.duration_min > 0 ? r.duration_min : 60;
    out.push({
      id,
      clientId: str(r.client_id) ?? '',
      trainerId: str(r.trainer_id) ?? '',
      startsAt,
      durationMin: dur,
      note: str(r.note),
      // An unrecognised state falls back to 'asked' — the state that claims
      // nothing. It never falls back to 'accepted'.
      state: asRequestState(r.state) ?? 'asked',
      sessionId: str(r.session_id),
      declineNote: str(r.decline_note),
      answeredAt: str(r.answered_at),
      createdAt: str(r.created_at) ?? startsAt,
    });
  }
  return out;
}

/* ── what has become of it ─────────────────────────────────────────────── */

/**
 * The outcome, which is the stored state unless the clock has overtaken it.
 *
 * Only an unanswered request can lapse. An accepted one that has been and gone
 * is a session that happened; a declined one stays declined for ever. Reading
 * either as 'expired' would erase an answer the coach actually gave.
 */
export function outcomeOf(r: Pick<SessionRequest, 'state' | 'startsAt'>, now: number = Date.now()): RequestOutcome {
  if (r.state !== 'asked') return r.state;
  const t = Date.parse(r.startsAt);
  // An unparseable hour is not a lapsed one. Treating it as expired would
  // retire somebody's live question on the strength of a string this file
  // failed to read.
  return Number.isFinite(t) && t <= now ? 'expired' : 'asked';
}

/** Still a live question: the coach can still answer it and the member can
 *  still take it back. */
export const isLive = (r: Pick<SessionRequest, 'state' | 'startsAt'>, now: number = Date.now()): boolean =>
  outcomeOf(r, now) === 'asked';

/**
 * The coach's queue: what they have actually been asked, soonest first.
 *
 * Generic over the row rather than typed to `SessionRequest`, so the coach
 * screen's own shape — which carries the client's NAME alongside — survives the
 * filter. A signature that flattened it here would have made the screen cast
 * the name back on afterwards, which is where a name belonging to the wrong row
 * gets introduced.
 */
export function coachQueue<T extends Pick<SessionRequest, 'state' | 'startsAt'>>(
  list: readonly T[], now: number = Date.now(),
): T[] {
  return list.filter((r) => isLive(r, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The member's own list: everything, newest question first, whatever came of
 *  it. Deliberately NOT filtered — a member needs to see the declines. */
export function myRequests<T extends Pick<SessionRequest, 'createdAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** How many of each outcome, for a screen that has to say what it is holding.
 *  Only ever computed by a caller that knows it has the whole set — see
 *  `isWhole` in src/ui/loadStatus.ts. */
export function countByOutcome(
  list: readonly SessionRequest[], now: number = Date.now(),
): Record<RequestOutcome, number> {
  const out: Record<RequestOutcome, number> = { asked: 0, accepted: 0, declined: 0, withdrawn: 0, expired: 0 };
  for (const r of list) out[outcomeOf(r, now)] += 1;
  return out;
}

/* ── the five sentences ────────────────────────────────────────────────── */

/**
 * The short label beside a request. Title Case, like every other label in this
 * app — and NONE of them is the word "Booked", including the accepted one,
 * which says what it became rather than what it was.
 */
export const OUTCOME_LABEL: Record<RequestOutcome, string> = {
  asked: 'Waiting on Your Coach',
  accepted: 'In Your Calendar',
  declined: 'Your Coach Said No',
  withdrawn: 'You Took It Back',
  expired: 'The Time Passed',
};

/**
 * What a member is told, per outcome. Five sentences, deliberately not one.
 *
 * `when` is a preformatted time label — this file does not format dates,
 * because a locale is the reader's and `appLocale()` is where that is settled.
 * It is passed in already written so no sentence here can be assembled around a
 * dash: a caller with no readable time has no business drawing this row at all.
 *
 * The 'asked' sentence is the one that has to be exactly right. It carries the
 * expiry rule with it, because the member is reading it at the moment they are
 * deciding whether to rely on the hour.
 */
export function outcomeLine(
  r: Pick<SessionRequest, 'state' | 'startsAt' | 'declineNote'>,
  when: string,
  now: number = Date.now(),
): string {
  switch (outcomeOf(r, now)) {
    case 'asked':
      return `You asked for ${when}. Nothing is booked and the time is not held for you — your coach has not answered yet, and this stops standing once ${when} arrives.`;
    case 'accepted':
      return `Your coach said yes to ${when}, so it is a real session now and it is on your calendar.`;
    case 'declined':
      return r.declineNote
        ? `Your coach couldn’t do ${when}, and said: “${r.declineNote}” Ask for another time, or message them.`
        : `Your coach couldn’t do ${when}. They didn’t say why — ask for another time, or message them.`;
    case 'withdrawn':
      return `You took back your request for ${when}, so your coach is no longer being asked about it.`;
    case 'expired':
      return `${when} came and went without an answer, so nothing was arranged and nobody is expecting you. Ask for a time further ahead if you still want one.`;
  }
}

/**
 * The rule about an unanswered request, said BEFORE the member relies on it.
 *
 * This belongs on the asking screen and not on a screen somebody reaches after
 * being disappointed. It is the whole of the policy in one sentence, and the
 * SQL header, the test and this string all state the same rule.
 */
export const EXPIRY_RULE =
  'A request stands until the time you asked for arrives. If your coach hasn’t answered by then it lapses on its own, nothing is arranged, and nobody is expecting you.';

/** Said on the asking screen, above the button. The one sentence that has to
 *  survive being read quickly. */
export const NOT_A_BOOKING =
  'This asks your coach for a time. It is not a booking: no session is held, nothing comes off your sessions, and nothing is arranged until your coach says yes.';

/** What the coach is told, once, about what accepting does. */
export const COACH_ACCEPT_RULE =
  'Saying yes puts a real session in your calendar at that time and tells your client it is on. Saying no tells them too, so they can ask for something else.';

/* ── asking: what the screen refuses before the server has to ──────────── */

/** The longest note either side may attach. Matches the CHECK in part 740 —
 *  a field that lets somebody type past the constraint is a write that fails
 *  after they have written. */
export const REQUEST_NOTE_MAX = 400;

/**
 * How far ahead a request may be made.
 *
 * There is a horizon because a request has to be a question somebody can
 * usefully answer, and "are you free on a Tuesday in March next year" is not
 * one — a coach cannot say yes to it honestly, and a member holding a
 * seven-month-old unanswered request has been misled by their own screen.
 * Ninety days is a quarter, which is as far as any coach in this app publishes.
 */
export const REQUEST_HORIZON_DAYS = 90;

/**
 * How many unanswered requests one member may have with one coach at once.
 *
 * The same number as `session_request_live_cap()` in part 740, restated here so
 * the screen can refuse before the write rather than after it. If the two ever
 * disagree the server wins and `askRefusalNote('too-many')` is what the member
 * reads, which is why that sentence does not name a figure.
 */
export const REQUEST_LIVE_CAP = 10;

/**
 * Why this request cannot be sent, or null when it can.
 *
 * Every one of these is also enforced by the server — none of it is trusted to
 * the phone. This exists so the member is told at the moment they tap, in a
 * sentence about what they did, instead of being handed a refusal code.
 *
 * `myBusy` is the member's OWN commitments, which their app can see: their
 * booked sessions. Asking for an hour they are already in a session for is a
 * mistake worth catching here, and one the server does not check — part 740
 * refuses a clash on the COACH's diary, and the member's own diary is theirs.
 */
export function askBlocker(
  startsAt: string,
  durationMin: number,
  now: number,
  opts: {
    myBusy?: readonly BusySpan[];
    /** The member's own live requests with this coach. */
    live?: readonly SessionRequest[];
  } = {},
): string | null {
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return 'Pick a day and a time first.';
  if (t <= now) return 'That time has already passed. Pick a time that is still ahead.';
  if (t > now + REQUEST_HORIZON_DAYS * 86_400_000) {
    return `That is more than ${REQUEST_HORIZON_DAYS} days away. Ask nearer the time — your coach can’t answer for a date that far out.`;
  }
  if (!Number.isFinite(durationMin) || durationMin <= 0) return 'Pick how long you want.';

  const live = (opts.live ?? []).filter((r) => isLive(r, now));
  if (live.some((r) => Date.parse(r.startsAt) === t)) {
    return 'You have already asked for that time and your coach hasn’t answered yet.';
  }
  if (live.length >= REQUEST_LIVE_CAP) {
    return 'You have as many unanswered requests as you can have at once. Wait for your coach to answer one, or take one back.';
  }
  if (opts.myBusy && opts.myBusy.length && overlaps(startsAt, durationMin, opts.myBusy)) {
    return 'You already have a session booked then.';
  }
  return null;
}

/* ── the server's refusals, in words ───────────────────────────────────── */

/**
 * What `request_session` said, as a sentence.
 *
 * An unrecognised reason gets a sentence that claims nothing about why — a
 * screen inventing a cause for a refusal it does not understand is how somebody
 * ends up trying the same thing six times.
 */
export function askRefusalNote(reason: string | null | undefined): string {
  switch (reason) {
    case 'not-signed-in':
      return 'You are not signed in any more, so nothing was sent. Sign in and ask again.';
    case 'no-coach':
      return 'You don’t have a coach on your account yet, so there is nobody to ask. Join your coach first and this will work.';
    case 'in-the-past':
      return 'That time has already passed, so nothing was sent. Pick a time that is still ahead.';
    case 'bad-time':
    case 'bad-duration':
      return 'That time couldn’t be read, so nothing was sent. Pick the day and the time again.';
    case 'already-asked':
      return 'You have already asked for that time and your coach hasn’t answered yet, so nothing new was sent. Your original request still stands.';
    case 'too-many':
      return 'You have as many unanswered requests as you can have at once, so this one was not sent. Wait for your coach to answer one, or take one back.';
    default:
      return 'That request was not sent, so your coach has not been asked. Nothing has changed — try again in a moment.';
  }
}

/**
 * What `answer_session_request` said, as a sentence for the COACH.
 *
 * The three clash reasons name the obstacle, which is the whole point of
 * checking for them separately in part 740: "you are teaching then" is
 * something a coach can act on and "that didn't work" is not. `className` is
 * the class the server named, where it named one — and the sentence is written
 * so it still reads without one, because a sentence built around a missing
 * value is the defect `check:prose` exists for.
 */
export function answerRefusalNote(reason: string | null | undefined, className?: string | null): string {
  switch (reason) {
    case 'not-signed-in':
      return 'You are not signed in any more, so nothing was answered, nothing was created and your client has not been told anything.';
    case 'not-yours':
      return 'That request isn’t on your list any more. Pull down to refresh.';
    case 'already-answered':
      return 'That one has already been answered — by you on another device, or a moment ago. Nothing was changed and no second session was made.';
    case 'expired':
      return 'The time this asked for has passed, so there is nothing left to say yes to. Your client can ask for another time.';
    case 'clash-booked':
      return 'You already have a session booked then, so nothing was created and your client has not been told it is on. Decline this one, or move the session you have.';
    case 'clash-blocked':
      return 'You have marked that time as unavailable, so nothing was created. Clear the block on your calendar first, or decline this one.';
    case 'clash-class':
      return className
        ? `You are down to teach ${className} then, so nothing was created. Decline this one, or ask the gym to move the class.`
        : 'You are down to teach a class then, so nothing was created. Decline this one, or ask the gym to move the class.';
    case 'clash':
      return 'Something else went into your calendar at that time while this was being answered, so nothing was created. Refresh and look at what is there before you answer again.';
    default:
      return 'That was not answered, so your client has not been told anything and nothing was created. Try again in a moment.';
  }
}

/**
 * What a member is told the instant their request lands.
 *
 * Written to be true of a request and of nothing else: it names what was sent,
 * says plainly that nothing is held, and carries the lapse rule — because this
 * is the alert somebody reads once and then acts on for a week.
 */
export function askedConfirmation(when: string, coachName: string | null): string {
  const who = coachName ? `${coachName} has` : 'Your coach has';
  return `${who} been asked about ${when}. Nothing is booked yet and the time is not held for you — you will see the answer here. ${EXPIRY_RULE}`;
}

/** What the coach's own answer says back to them. Two sentences, because the
 *  two answers do genuinely different things. */
export function answeredConfirmation(accepted: boolean, when: string): string {
  return accepted
    ? `${when} is in your calendar now as a booked session, and your client can see it.`
    : `You have said no to ${when}. Your client can see the answer and can ask for another time.`;
}

/* ── the coach's queue, in one line ────────────────────────────────────── */

/**
 * The heading figure on the coach's screen.
 *
 * Null for nothing waiting, so a caller can render it unconditionally without
 * drawing a banner about zero — the same shape `outboxNote` uses. It is only
 * ever called with a whole read; a count over a truncated one is a figure about
 * an unknown fraction of the set, which src/ui/loadStatus.ts refuses.
 */
export function coachQueueNote(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 client is asking for a time you have not opened.'
    : `${n} clients are asking for times you have not opened.`;
}
