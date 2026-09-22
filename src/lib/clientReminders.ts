// Client · the "Session in 1 hour" banner, and the half of it that was missing.
//
// ── What was armed, and what was never taken back ─────────────────────────
//
// `bookSession` in src/ui/sessions.tsx fired ONE `scheduleLocal` at the moment
// a member tapped Book, threw the notification id away, and that was the whole
// of the client's session-reminder machinery. A local notification survives the
// app being closed, so what that bought was:
//
//   · a banner an hour before a session the member has since CANCELLED — the
//     coach's side of this states the rule in as many words (src/lib/
//     coachReminders.ts: "AN ARMED REMINDER FOR A SESSION THAT MOVED IS WORSE
//     THAN NO REMINDER"), and the client's side had no cancellation pass at all;
//   · nothing at all for the session they MOVED it to, because a move goes
//     through `reschedule_my_session` and never through `bookSession`;
//   · nothing at all for a session that arrived any other way — a standing
//     appointment materialised by the nightly job, a waitlist promotion, or the
//     coach booking them in from their own calendar. Those are ordinary booked
//     rows on the member's diary and the handset had never heard of them.
//
// So the member most likely to be reminded was the one who booked by hand and
// then did not change anything, and the member most likely to be reminded about
// the WRONG hour was the one who did.
//
// ── Why this file is separate from src/lib/coachReminders.ts ─────────────
//
// The arithmetic is the same and is imported rather than copied: `toArm`,
// `staleReminders`, `expiredReminders`, `remindAt` and `ArmedMap` all decide
// exactly the same questions for a member as they do for a coach, and two
// copies of that reasoning would be two chances to fix only one of them.
//
// What is NOT the same is two things, and both are here:
//
//   · the WORDS. The coach's banner names the client, because a coach with four
//     sessions today needs to know which one. A member has one session at a
//     time and needs to know whose it is, which is the opposite substitution.
//   · the WINDOW — which is no longer a difference, and the paragraph that used
//     to stand here is worth keeping as the reason. `staleReminders` refuses to
//     cancel an arming for a time the caller did not read, and BOTH screens
//     used to derive that window from the rows that came back — which cannot
//     see a session that was DELETED, because a deleted row is exactly the one
//     that is missing. The member's side was built on `readWindow`, which
//     states the window from the READ's own status instead; the coach's side
//     was not, and its furthest-future session could therefore never have its
//     banner cancelled. `readWindow` now lives beside the rest of the shared
//     arithmetic in coachReminders.ts and both screens use it. It is re-exported
//     here because this is the file that argued for it.
//
// Pure — no React, no Supabase, no clock of its own. The scheduling is in
// src/ui/clientReminders.ts, which cannot be asserted without a handset.
import type { RemindableSession } from './coachReminders';

/**
 * How far ahead a member's reminders are armed.
 *
 * Sixty days, against the coach's seven, and the difference is a difference in
 * the two people's diaries rather than a preference.
 *
 * `ARM_AHEAD_DAYS` is short because iOS caps one app at 64 pending local
 * notifications and drops the rest silently, so a coach with a full book would
 * lose the sessions nearest today — and a coach opens their schedule most days,
 * so a short window re-armed often loses nothing.
 *
 * A member has one session at a time and may not open the app between booking
 * and turning up. That case is the one the arming this replaced actually got
 * right: it fired at the moment of the tap, so a session booked three weeks out
 * was armed three weeks out. A seven-day window would have handed that case
 * back as a regression — no banner for the member who books ahead and then puts
 * their phone away — while fixing the three cases around it. Sixty days covers
 * everything `REQUEST_HORIZON_DAYS` lets anybody ask for and is comfortably
 * inside the platform cap for any member's book.
 */
export const CLIENT_ARM_AHEAD_DAYS = 60;

/**
 * The banner's body.
 *
 * The coach's name where it is known, because a member who trains with two
 * people at the same gym is being told which building to walk to. Never
 * assembled around a missing value — an unreadable start time says "soon"
 * rather than putting a dash in the middle of a sentence
 * (scripts/check-prose.mjs), and no coach name simply drops the clause.
 */
export function clientReminderBody(startsAt: string, coachName: string | null): string {
  const at = new Date(startsAt);
  const time = Number.isFinite(at.getTime())
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const who = coachName ? ` with ${coachName}` : '';
  return time
    ? `Your session${who} starts at ${time}, in an hour.`
    : `Your session${who} starts in an hour.`;
}

/**
 * The member's own booked sessions, in the shape the arming rules take.
 *
 * `clientId === me` and nothing else. The provider holds every row RLS let this
 * account read, which for a member is their own sessions AND every open slot
 * their coach has published — and an open slot is an offer, not an appointment.
 * `toArm` refuses a row whose status is not 'booked' as well, so this is belt
 * and braces on the one filter that must not slip: a banner telling somebody to
 * turn up for a slot nobody has taken sends them to an empty gym.
 */
export function myRemindable(
  sessions: readonly { id: string; clientId: string | null; startsAt: string; status: string; outcome?: string | null }[],
  me: string | null,
): RemindableSession[] {
  if (!me) return [];
  const out: RemindableSession[] = [];
  for (const s of sessions) {
    if (s.clientId !== me) continue;
    out.push({ id: s.id, startsAt: s.startsAt, status: s.status, outcome: s.outcome ?? null, clientName: null });
  }
  return out;
}

/**
 * The span of time a read is entitled to speak about, re-exported.
 *
 * The rule and its reasoning are in src/lib/coachReminders.ts beside
 * `staleReminders`, which is the function it protects, and beside `toArm` and
 * `remindAt`, which this file already takes from there. It is named again here
 * because this is the module that argued for it and because the member's
 * screens import their reminder vocabulary from this file; a second definition
 * would be a second thing to fix.
 */
export { readWindow } from './coachReminders';
