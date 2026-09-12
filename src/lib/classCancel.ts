// What a member can be told before they cancel a class booking.
//
// ── Why this is a module and not a string in the screen ───────────────────
//
// The PT path is scrupulous. `cancelWarningFor` in src/ui/sessions.tsx reads
// the coach's own notice period and late fee, states both, and says so plainly
// when the policy could not be read. The class path — the one the GYM actually
// bills — said nothing at all: `Alert.alert('Cancel booking?', '<title> ·
// <branch> · <day> <time>')` and two buttons. Silence reads as free.
//
// The reason it said nothing is real: this app does not hold a gym's class
// cancellation policy. There is no column for it, no screen where an owner sets
// one, and inventing "24 hours" here would be worse than the silence — a member
// told they are inside a window their gym does not run is being given a fact
// this app made up.
//
// So this says the two things that ARE true and are worth knowing: how long
// until the class starts, and that the charge is the gym's decision and not one
// this app can see. That is the same shape as the PT path's own unknown-policy
// sentence, which exists for exactly this case.
//
// ── No brand name in the copy ─────────────────────────────────────────────
//
// "Repple does not hold your gym's policy" is a sentence about a supplier the
// member of a white-label gym has never heard of. It says "this app".

import { wholeMoney } from './coachMoney';

/** How many whole hours until the class starts. Null when the timestamp is not
 *  one, and 0 for a class that has already begun — never negative, which would
 *  print as "starts in -3 hours". */
export function hoursUntil(startsAt: string, now: number = Date.now()): number | null {
  const t = Date.parse(startsAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((t - now) / 3_600_000));
}

/** When the class begins, in the member's own terms. Null when there is nothing
 *  honest to say about it. */
export function startsInLine(startsAt: string, now: number = Date.now()): string | null {
  const h = hoursUntil(startsAt, now);
  if (h == null) return null;
  if (h === 0) {
    const t = Date.parse(startsAt);
    return t <= now ? 'This class has already started.' : 'This class starts within the hour.';
  }
  if (h === 1) return 'This class starts in about an hour.';
  if (h < 48) return `This class starts in about ${h} hours.`;
  return `This class starts in about ${Math.round(h / 24)} days.`;
}

/**
 * The one thing this app can say about what cancelling costs, which is that it
 * does not know.
 *
 * Deliberately not softened into "this is free". A gym charging a late
 * cancellation is ordinary, the member is the one who can find out, and a
 * confirmation that stays quiet about money is read as a confirmation that
 * there is none.
 */
export const CLASS_POLICY_UNKNOWN_NOTE =
  'Your gym decides whether a late cancellation or a missed class is charged. This app does not hold that policy, so it cannot tell you what this will cost — ask the gym if you are not sure.';

/**
 * What a gym has said about late cancellations, as the server hands it over.
 *
 * Every field is independently nullable and each null means the same thing:
 * unstated. `notice: 0` and `fee: 0` are STATEMENTS — "no notice period" and
 * "no charge" — and are not the same as never having said, which is the whole
 * reason supabase/parts/2615 refuses a default on either column.
 */
export interface ClassCancelPolicy {
  /** Hours before the class inside which the gym may charge. */
  notice: number | null;
  /** What they charge, in `currency`. */
  fee: number | null;
  /** The gym's unit. Without it a fee is a number nothing may render. */
  currency: string | null;
}

/** The read, kept apart from its answer. `null` is a read that did not land,
 *  which is not a gym that has said nothing — see `classCancelBody`. */
export type ClassPolicyRead = ClassCancelPolicy | null;

/**
 * What cancelling this class will cost, in the gym's own terms.
 *
 * Null when there is nothing more honest to say than
 * `CLASS_POLICY_UNKNOWN_NOTE`, which the caller falls back to. Four outcomes
 * and they are deliberately not interchangeable:
 *
 *   inside the window, fee known    say the hours AND the amount.
 *   inside the window, fee unknown  say the hours, and that they set the
 *                                   charge. Naming a window while inventing
 *                                   its price would be the worst of both.
 *   outside the window              say so. This is the sentence a member
 *                                   actually wants, and the only one in this
 *                                   file that is good news.
 *   no window stated                null; the caller says we do not hold it.
 *
 * The amount is withheld whenever the gym has no currency on record. A fee of
 * "8.5" with no unit is not a price, and picking one is the single thing the
 * money layer of this app never does.
 */
export function classChargeLine(
  policy: ClassPolicyRead, startsAt: string, now: number = Date.now(),
): string | null {
  if (!policy || policy.notice == null) return null;
  const h = hoursUntil(startsAt, now);
  if (h == null) return null;
  const inside = h < policy.notice;
  if (!inside) {
    return policy.notice === 0
      // A stated zero-hour window means nothing is ever late, and "you are
      // outside the 0-hour notice" is not a sentence anybody should read.
      ? 'Your gym does not run a notice period for classes, so cancelling this is not a late cancellation.'
      : `You are outside your gym\u2019s ${policy.notice}-hour notice, so this is not a late cancellation.`;
  }
  const window = `Cancelling now is inside your gym\u2019s ${policy.notice}-hour notice.`;
  if (policy.fee == null) {
    return `${window} Your gym decides what a late cancellation costs and has not told this app the amount \u2014 ask them if you are not sure.`;
  }
  if (policy.fee === 0) {
    return `${window} Your gym has recorded no charge for one, so this is free.`;
  }
  // `wholeMoney` and not `toFixed(2)`, which check:locale caught in the first
  // version of this line: two decimal places with a full stop is wrong in every
  // locale that writes 8,50 and wrong in the sixteen currencies that have no
  // minor unit at all — a yen fee would have printed as ¥8.50 for ¥8. It also
  // answers null for a missing or unknown currency, which is the same refusal
  // the branch above makes and is why that branch is checked first rather than
  // trusted to it.
  const amount = wholeMoney(policy.fee, policy.currency);
  if (!policy.currency || !amount) {
    // The gym has a figure and no unit this build can render. Naming the figure
    // without it would be the app choosing a currency on a gym's behalf.
    return `${window} Your gym charges a late cancellation fee, and there is no currency on their record here, so this app cannot state the amount \u2014 ask them what it is.`;
  }
  return `${window} Your gym charges ${amount} for one.`;
}

/**
 * Read one class's cancellation policy from the server.
 *
 * Lazily required, like every other I/O in this half of the codebase's pure
 * modules, so the sentences above stay runnable under plain `node` in
 * classCancel.test.ts without dragging in AsyncStorage.
 *
 * Null for every unhappy outcome — no session, a refusal, a network fault, a
 * build whose database has not had part 2615 applied — and that null is NOT
 * "this gym has no policy". `classCancelBody` renders it as the
 * we-do-not-hold-it sentence, which is the honest thing to say when we could
 * not ask. A row with every field null means the gym genuinely has not stated
 * one, and reaches the same sentence by a different route; the distinction
 * costs nothing here and is kept because it is the distinction the rest of
 * this file is about.
 */
export async function fetchClassCancelPolicy(classId: string): Promise<ClassPolicyRead> {
  if (!classId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } = require('./supabase') as typeof import('./supabase');
    const { data, error } = await supabase.rpc('class_cancel_policy', { p_class: classId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const num = (v: unknown): number | null =>
      v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    return {
      notice: num((row as Record<string, unknown>).notice_hours),
      fee: num((row as Record<string, unknown>).fee),
      currency: String((row as Record<string, unknown>).currency ?? '').trim().toUpperCase() || null,
    };
  } catch {
    return null;
  }
}

/**
 * The body of the "Cancel booking?" confirmation.
 *
 * `what` is the class as the screen already words it, and is passed in rather
 * than assembled here: the screen owns the title, the branch and the times, and
 * this module owns the sentence about the consequence.
 */
export function classCancelBody(
  what: string, startsAt: string, now: number = Date.now(), policy: ClassPolicyRead = null,
): string {
  const when = startsInLine(startsAt, now);
  // The policy sentence REPLACES the unknown one when there is a policy, and
  // never sits beside it: "your gym charges GBP 8.50" followed by "this app
  // cannot tell you what this will cost" is two answers to one question.
  //
  // `policy` defaults to null so every existing call site keeps the behaviour
  // it was written with — a screen that has not been taught to read the policy
  // must not start claiming there isn't one.
  const charge = classChargeLine(policy, startsAt, now) ?? CLASS_POLICY_UNKNOWN_NOTE;
  return [what, when, charge].filter(Boolean).join('\n\n');
}
