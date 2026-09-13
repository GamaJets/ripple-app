// A member asking for a standing appointment — and why asking is all they can
// do.
//
// ── The half of the feature that was missing ──────────────────────────────
//
// `supabase/parts/135-a-standing-appointment.sql` stores the arrangement, and
// app/(client)/standing.tsx gave the member everything they can do to one that
// exists: see it, pause it, pause particular dates, cancel one occurrence, end
// it. The empty state of that screen said "Ask your coach to set one up" and
// gave them no way to do it — a sentence telling somebody to go and have a
// conversation the app could have started for them.
//
// ── WHY THIS IS A REQUEST AND NOT A CREATE ────────────────────────────────
//
// `useRecurringSeries().create` exists, the member's screen destructures the
// hook, and the obvious reading of the gap is that the client app should call
// it. It must not, and the server settles it: `create_session_series` raises
// 42501 —
//
//     if not exists (select 1 from clients c
//                    where c.id = p_client and c.trainer_id = v_uid)
//       then raise exception 'They are not your client.'
//
// — so for a member the call cannot succeed at all; `p_client` is themselves
// and they are nobody's coach. That refusal is not an oversight to route
// around. Creating a series writes eight weeks of real sessions into a coach's
// diary immediately (`_materialise_session_series` runs inside the same call),
// against hours the coach may never have opened, and every one of those
// occurrences draws a credit as it is delivered (part 193). A member who could
// do that unilaterally could fill somebody's Tuesday mornings for two months
// and commit their own pack to paying for it.
//
// So the honest shape is the one this app already has for "an hour my coach has
// not opened": `request_session` (supabase/parts/740). The member asks for the
// FIRST occurrence as an ordinary request — nothing is booked, nothing comes
// off a pack, and the coach's own diary is what the server checks — and the
// note says what they are really asking for, which is every week. The coach
// sets the series up from their own calendar, where the create call belongs and
// where it already works.
//
// Everything in here is the words and the day arithmetic. The reads and writes
// are src/ui/sessionRequests.ts, and the rules about what may be asked at all
// — the horizon, the live cap, the clash with the member's own diary — are
// `askBlocker` in src/lib/sessionRequests.ts and are NOT restated here.
import { REQUEST_NOTE_MAX } from './sessionRequests';

/**
 * What the member is told before they ask, and the sentence this whole module
 * is built around.
 *
 * It says the two things somebody could otherwise get wrong in a way that costs
 * them: that this is not a booking, and that the weekly part is the coach's to
 * agree. `NOT_A_BOOKING` in sessionRequests.ts says the first half for one-off
 * asks and is printed beside this rather than reworded into it.
 */
export const STANDING_ASK_RULE =
  'Only your coach can set up a standing appointment, because it books real time in their diary every week. '
  + 'This asks them for the first one and tells them you would like the same time weekly. Nothing is booked and '
  + 'nothing comes off your sessions unless they say yes.';

/** What a member who has no coach on their account is told, in place of the
 *  ask. The one-off version — `NO_COACH_TO_ASK` — is about a single hour, and
 *  this screen is about a weekly one. */
export const NO_COACH_FOR_STANDING =
  'You don’t have a coach on your account yet, so there is nobody to agree a weekly time with. '
  + 'Once you have one, this is where you ask them for it.';

/** The short form, used when the composed sentence would not fit the column the
 *  database enforces, or when the day or the time could not be written. */
const SHORT_NOTE =
  'Could we make this a standing appointment — the same time every week? I have asked for the first one here.';

/** A label that says nothing. `fmtClock` answers '—' for an hour it cannot
 *  write, and an em dash as the SUBJECT of a sentence reads as the app having
 *  broken — see scripts/check-prose.mjs. */
const unwritten = (s: string | null | undefined): boolean => {
  const v = String(s ?? '').trim();
  return v === '' || /^[—–-]+$/.test(v);
};

/**
 * The note that travels with the request, naming the weekly slot being asked
 * for.
 *
 * The labels are passed in already written, because they are the READER'S — the
 * weekday and the clock come from `weekdayName` and `fmtClock`, which are
 * locale-aware and which a module compiled and run under plain node has no
 * business calling for itself.
 *
 * Never longer than `REQUEST_NOTE_MAX`. That is not a nicety: part 740 puts a
 * CHECK on the column, so a note that overruns is a write that fails AFTER
 * somebody has decided to send it — and a weekday written in full in Thai or
 * Malayalam is several times longer than "Tuesday". The long form is dropped
 * for the short one rather than cut off mid-sentence, because a truncated ask
 * is a question the coach has to guess at.
 */
export function standingAskNote(weekday: string, time: string): string {
  if (unwritten(weekday) || unwritten(time)) return SHORT_NOTE;
  const full = `Could we make this a standing appointment — every ${weekday.trim()} at ${time.trim()}? `
    + 'I have asked for the first one here; setting up the weekly slot is yours to do.';
  return full.length <= REQUEST_NOTE_MAX ? full : SHORT_NOTE;
}

/** A bare `YYYY-MM-DD`, compared and built as a string, never parsed as an
 *  instant — src/lib/localDate.ts is the account of what that costs. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The first date a weekly slot would fall on, as a bare local day.
 *
 * `skipToday` is the caller's answer to a question only the caller can settle:
 * whether the hour being asked for has already gone today. The screen builds
 * the instant from this day and its own local clock, compares it with now, and
 * asks again with `skipToday` when it has passed — which is one week later, and
 * not "tomorrow" and not "the next one after now".
 *
 * ── Why the arithmetic is in UTC when the answer is a local day ───────────
 *
 * utc-day-ok: nothing here is an instant. Both ends are bare `YYYY-MM-DD`
 * strings and UTC is used only as a calendar with no daylight saving in it, so
 * that adding six days cannot land on the same date twice or skip one — the
 * same shape `daysBetween` in src/lib/packExpiry.ts uses, and the reason
 * `npm run test:zones` reads the same day in Kiritimati and in Midway.
 *
 * Null for a day that will not read and for a weekday that is not one of the
 * seven, because a date invented out of either is a date somebody turns up on.
 */
export function firstStandingDay(today: string, dow: number, skipToday: boolean): string | null {
  const m = DAY.exec(String(today ?? '').trim());
  if (!m) return null;
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(base)) return null;
  const from = new Date(base);
  // Guards against a day that parses but is not a real date — '2026-02-31'
  // rolls forward to March and would put the appointment on the wrong weekday.
  if (from.getUTCDate() !== +m[3] || from.getUTCMonth() !== +m[2] - 1) return null;
  let offset = (dow - from.getUTCDay() + 7) % 7;
  if (offset === 0 && skipToday) offset = 7;
  const at = new Date(base + offset * 86_400_000);
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}

/** The slot a member is asking for, in the terms `session_series` holds one:
 *  Sunday-first `dow`, and a wall-clock hour and minute. */
export interface StandingSlot {
  dow: number;
  hour: number;
  minute: number;
}

/**
 * Why this particular ask is not worth sending, or null.
 *
 * The only thing checked here is the one the request rail cannot see: the
 * member already HAS that weekly slot. `request_session` knows nothing about
 * `session_series`, so without this a member taps a day they already train on
 * and their coach is asked, in writing, to arrange something that has been
 * running for a year.
 *
 * `whole` is the load status of the arrangements read, and null under a read
 * that did not finish is deliberate. An empty list from a failed read is not an
 * empty diary — the house rule this codebase keeps rewriting — and withholding
 * the ask on the strength of one would leave a member who cannot reach the
 * server with no way to reach their coach either. The cost of being wrong in
 * this direction is a duplicate question; in the other it is silence.
 */
export function standingAskBlocker(
  series: readonly (StandingSlot & { active: boolean })[],
  slot: StandingSlot,
  whole: boolean,
): string | null {
  if (!whole) return null;
  const same = series.some((s) => s.active
    && ((s.dow % 7) + 7) % 7 === ((slot.dow % 7) + 7) % 7
    && s.hour === slot.hour && s.minute === slot.minute);
  return same
    ? 'You already have a standing appointment at that time. Pick another time, or pause the one you have if you need a break from it.'
    : null;
}
