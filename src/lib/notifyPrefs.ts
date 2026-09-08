// Which notifications a member wants, and when they will accept them.
//
// ── The defect this closes ─────────────────────────────────────────────────
//
// One row on the settings screen — "Push Notifications" — covering session
// reminders, class reminders, coach messages, notices, invoices and everything
// this app has ever sent. No per-category control and no quiet hours. So the
// only way to stop a 6am class reminder was to stop hearing from your coach,
// and the only way to sleep through a hydration nudge was to turn the whole
// thing off and lose the session reminders too.
//
// ── What this can honestly control, and what it cannot ────────────────────
//
// This is the half of the problem that is genuinely the app's to solve, and it
// is important to be precise about which half, because a switch that does not
// work is worse than no switch.
//
//   LOCAL notifications are scheduled BY THIS APP, on this phone, and can be
//   gated here completely: session reminders (src/ui/sessions.tsx), class
//   reminders (app/(client)/classes.tsx), the streak nudge
//   (app/(client)/dashboard.tsx), badge unlocks (src/ui/badgeWatch.tsx) and
//   every daily reminder (app/(client)/reminders.tsx). All of them go through
//   src/ui/pushNotifications.ts, which is where the gate is applied so that a
//   caller cannot skip it — the same argument `registerForPush` makes about
//   `pushConsent`.
//
//   REMOTE pushes are sent by the send-push edge function from a server that
//   has never heard of these preferences. Turning off a remote category here
//   would produce a switch that reads "off" while the banner keeps arriving,
//   which is exactly the shape of the bug src/lib/pushConsent.ts was written
//   for. So remote-only categories are NOT offered as switches, and the screen
//   says plainly which control governs them.
//
// `CATEGORIES` below records which is which, so the screen cannot offer a
// switch for something this build cannot honour.
//
// ── The coach's quiet hours are a different mechanism ──────────────────────
//
// `inQuietHours` and `whenToDeliver` below are for LOCAL notifications and only
// for them, and that limit is the reason they cannot be reused for a coach:
// every coach-directed notification is remote, so there is no scheduled trigger
// on this phone to move and no local clock at the point the decision is made.
// The coach's version therefore lives on the server, carries an IANA zone with
// it, and SUPPRESSES rather than shifts — src/lib/quietHours.ts and
// supabase/parts/530 carry that argument in full.
//
// The one thing the two share is the wrap: 22 → 7 means 22, 23, 0 … 6, with the
// end exclusive. That arithmetic is `hourInWindow` in quietHours.ts and is
// called from here rather than written twice, because two copies of it are two
// chances to disagree about an hour — and a disagreement costs somebody either
// an hour of sleep or an hour of silence, depending which way it falls.
//
// Pure — no react, no storage, no notifications module — so the rules are
// assertable without a phone.
import { hourInWindow } from './quietHours';

export type NotifyCategory =
  | 'sessions'      // "Session in 1 hour" for a booked PT slot
  | 'classes'       // "Spin in 1 hour" for a booked class
  | 'motivation'    // streaks at risk, badges unlocked, a quiet week
  | 'reminders'     // hydration, supplements, training, weigh-in, photo
  | 'coach';        // messages, notices, injuries, invoices — all remote

export interface CategoryDef {
  key: NotifyCategory;
  /** Title Case — a switch's label. */
  title: string;
  /** Sentence case prose under it. */
  note: string;
  /**
   * Whether THIS APP schedules it. False means the server sends it and a
   * switch here could not stop it, so no switch is offered.
   */
  local: boolean;
  /**
   * Whether quiet hours apply.
   *
   * A booked session at 6:30am is a thing the member ASKED FOR at a time they
   * chose, and silencing its one-hour warning because it falls inside quiet
   * hours would make them late for it. Quiet hours are for notifications the
   * app decided to send, not for the ones the member scheduled themselves.
   */
  quietable: boolean;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: 'sessions', title: 'Session Reminders', local: true, quietable: false,
    note: 'An hour before a personal-training session you have booked.',
  },
  {
    key: 'classes', title: 'Class Reminders', local: true, quietable: false,
    note: 'An hour before a class you have booked.',
  },
  {
    key: 'motivation', title: 'Streaks And Badges', local: true, quietable: true,
    note: 'When a streak is about to break, and when you unlock a badge.',
  },
  {
    key: 'reminders', title: 'Daily Reminders', local: true, quietable: true,
    note: 'The hydration, supplement, training and weigh-in reminders you set yourself.',
  },
  {
    key: 'coach', title: 'From Your Coach And Gym', local: false, quietable: false,
    // "so they follow the single Push Notifications switch rather than this
    // list" is what this said, and it was true when it was written. Part 530
    // made it false: `notify_quiet_hours` is keyed on `user_id` and both
    // senders apply it to whoever the recipient is, so a member's quiet hours
    // have reached these for as long as the rollout row has been enforced —
    // and nothing said so, because the sentence described the app rather than
    // the server. It now points at the control instead of naming an effect,
    // because whether the server applies it is a fact about the installation
    // and `quietAvailability` is what reads it.
    note: 'Messages, notices and invoices. These are sent from the server, so the switches on this list do not reach them. Quiet Hours is stored on your account rather than on this phone, which is why it can.',
  },
];

export interface NotifyPrefs {
  /** Per category. A category absent from the map is ON — see `allows`. */
  off: Partial<Record<NotifyCategory, boolean>>;
  /** Whether quiet hours are being applied at all. */
  quiet: boolean;
  /** 0–23, local. Inclusive: quiet begins at the top of this hour. */
  quietFromHour: number;
  /** 0–23, local. EXCLUSIVE: quiet ends at the top of this hour, so
   *  from 22 to 7 is silent from 22:00 through 06:59. */
  quietToHour: number;
}

/**
 * The state of somebody who has never opened the screen.
 *
 * Everything on and quiet hours OFF. Defaulting quiet hours to a plausible
 * 22:00–07:00 would be inventing an answer — the same figure this codebase
 * refuses to invent for a step goal or a water target — and it would silently
 * suppress a reminder somebody deliberately set for 06:30.
 */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  off: {},
  quiet: false,
  quietFromHour: 22,
  quietToHour: 7,
};

/**
 * The stored blob → preferences.
 *
 * Never throws and never returns null: an unwritten, corrupt or older blob is
 * indistinguishable from a fresh install, and a fresh install's answer is the
 * default above. Every field is validated independently, so one bad hour does
 * not discard the member's category choices.
 */
export function prefsFromStored(raw: string | null | undefined): NotifyPrefs {
  if (raw == null) return DEFAULT_NOTIFY_PREFS;
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return DEFAULT_NOTIFY_PREFS; }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_NOTIFY_PREFS;
  const off: Partial<Record<NotifyCategory, boolean>> = {};
  for (const c of CATEGORIES) {
    // Only `true` counts as off. A key holding a string, a number or null is
    // not an answer, and reading it as one would silence a category the member
    // never touched.
    if (parsed.off && parsed.off[c.key] === true) off[c.key] = true;
  }
  const hour = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback);
  return {
    off,
    quiet: parsed.quiet === true,
    quietFromHour: hour(parsed.quietFromHour, DEFAULT_NOTIFY_PREFS.quietFromHour),
    quietToHour: hour(parsed.quietToHour, DEFAULT_NOTIFY_PREFS.quietToHour),
  };
}

/** The definition for a category, or null. */
export function categoryDef(key: string): CategoryDef | null {
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

/* ── the switch that did not work ─────────────────────────────────────────
 *
 * The header above states, as a fact about this app, that badge unlocks
 * (src/ui/badgeWatch.tsx) go through `scheduleLocal` "which is where the gate
 * is applied so that a caller cannot skip it". `CATEGORIES` says the same thing
 * in the words on the switch: 'Streaks And Badges' — "When a streak is about to
 * break, and when you unlock a badge."
 *
 * badgeWatch.tsx calls `scheduleLocal(note.title, note.body, at, { route:
 * '/(client)/achievements' })` — FIVE arguments. There is no category, and
 * `scheduleLocal` reads `if (category && !allows(...))`, so a missing one is
 * not a gate at all. It is the only uncategorised caller of that function in
 * the three apps, and the consequence is exact: a member who turns off Streaks
 * And Badges goes on being congratulated, and a member with quiet hours set
 * gets the congratulation at the hour it happened, because `motivation` is
 * `quietable: true` and nothing asked.
 *
 * A switch that reads off while the banner keeps arriving is the shape of bug
 * src/lib/pushConsent.ts exists for, and it is worse here than a missing switch
 * would be: the member has been shown a control, used it, and been ignored.
 *
 * ── Why the fallback is by ROUTE and lives here ──────────────────────────
 *
 * The narrow fix is one argument at one call site, and this codebase has
 * already argued twice why that is not the fix: `registerForPush` puts the
 * consent gate inside the function "because there were three call sites … and
 * the next call site added would have been the fourth chance to forget", and
 * src/lib/notifyInbox.ts puts the record/skip decision at one choke point
 * rather than at eleven call sites. A category the caller may omit is a gate
 * the caller may skip, and the one caller that omitted it is the one whose
 * switch stopped working.
 *
 * So an omitted category falls back to what the ROUTE says, which is the same
 * structural signal `inboxIcon` and `notificationChannel` are derived from and
 * for the same reason: a notification that opens Achievements is about a badge
 * whoever wrote it. An explicit category always wins — this only ever fills a
 * hole — and a route nobody has classified still returns null and is still
 * delivered ungated, which is the safe direction the header argues for.
 */
const CATEGORY_BY_ROUTE: ReadonlyArray<readonly [string, NotifyCategory]> = [
  // Badges. The whole of the defect above, and 'motivation' is the category
  // whose own label already promises it.
  ['/(client)/achievements', 'motivation'],
  // The streak nudge's route, from app/(client)/dashboard.tsx. That caller
  // already passes 'motivation' explicitly and this changes nothing for it —
  // it is here so the table is a statement about the two motivational routes
  // rather than a single-entry patch, and so a second caller cannot land on
  // the same screen ungated.
  ['/(client)/workouts', 'motivation'],
];

/**
 * The category a route implies, or null for one this build cannot place.
 *
 * WHOLE-ROUTE matching with a query string allowed after it — the rule
 * `inboxIcon` and `notificationChannel` both use, stated rather than assumed so
 * that nobody "fixes" a miss by reordering the table.
 *
 * Null is the safe answer and it means "nobody has decided", not "no category".
 * An unclassified local notification is scheduled ungated, which is what it is
 * today: the failure of a missed gate is a banner somebody did not want, and
 * the failure of a default-deny is a session reminder that never arrives.
 */
export function categoryForRoute(route: string | null | undefined): NotifyCategory | null {
  const r = (route ?? '').trim();
  if (!r) return null;
  for (const [screen, key] of CATEGORY_BY_ROUTE) {
    if (r === screen || r.startsWith(screen + '?')) return key;
  }
  return null;
}

/**
 * Whether this category may be sent at all.
 *
 * ON unless the member explicitly turned it off. That direction matters: a
 * missing key, an unread store and a fresh install all mean "not answered", and
 * defaulting those to off would silence somebody's session reminders because a
 * JSON parse failed.
 *
 * A REMOTE category always returns true. Not because it is always wanted, but
 * because this function's answer only ever gates what this app schedules, and
 * returning false for a remote category would create the illusion that a switch
 * here had stopped something it cannot reach.
 */
export function allows(category: NotifyCategory, prefs: NotifyPrefs): boolean {
  const def = categoryDef(category);
  if (!def) return true;
  if (!def.local) return true;
  return prefs.off[category] !== true;
}

/**
 * Whether `hour` (0–23, local) falls inside the member's quiet hours.
 *
 * Handles the wrap, which is the ordinary case: 22 → 7 means 22, 23, 0, 1 … 6.
 * `from === to` is treated as NO quiet hours rather than as all of them — a
 * member who set both ends to the same hour has expressed a zero-length window,
 * and reading that as twenty-four silent hours would delete every notification
 * they have with no indication why.
 */
export function inQuietHours(hour: number, prefs: NotifyPrefs): boolean {
  if (!prefs.quiet) return false;
  // The wrap, the range check and the zero-length rule are all `hourInWindow`.
  // Behaviour here is unchanged to the character; what has changed is that the
  // coach's server-side window (src/lib/quietHours.ts) computes membership from
  // the same three lines rather than from a second copy of them.
  return hourInWindow(hour, prefs.quietFromHour, prefs.quietToHour);
}

/**
 * When a notification due at `at` should actually arrive.
 *
 * ── Shifted, never dropped ────────────────────────────────────────────────
 *
 * A hydration nudge that lands at 03:00 is a defect; a hydration nudge that
 * never arrives is a different defect and the member cannot tell it apart from
 * a broken reminder. So a quietable notification scheduled inside quiet hours
 * is moved to the moment quiet hours end, and one scheduled outside them is
 * untouched.
 *
 * A non-quietable category is returned unchanged whatever the hour: a booked
 * session at 6:30am is a thing the member asked for at a time they chose, and
 * delaying its warning until 07:00 would make them late for the session they
 * are being warned about.
 *
 * Returns a NEW Date. Mutating the caller's would move the scheduled instant
 * they still hold a reference to.
 */
export function whenToDeliver(at: Date, category: NotifyCategory, prefs: NotifyPrefs): Date {
  const def = categoryDef(category);
  if (!def?.quietable || !prefs.quiet) return new Date(at.getTime());
  if (!inQuietHours(at.getHours(), prefs)) return new Date(at.getTime());
  const out = new Date(at.getTime());
  out.setHours(prefs.quietToHour, deliveryMinute(at.getHours(), at.getMinutes(), prefs), 0, 0);
  // The window wrapped past midnight, so the end of it is TOMORROW morning
  // relative to the notification's own evening. Without this a 23:00 nudge with
  // a 22→07 window would be moved to 07:00 the same morning, sixteen hours in
  // the past, and `scheduleLocal` refuses a date in the past — so the reminder
  // would silently never be scheduled at all.
  if (out.getTime() <= at.getTime()) out.setDate(out.getDate() + 1);
  return out;
}

/**
 * The hour a REPEATING daily reminder should fire, given quiet hours.
 *
 * A repeating trigger has no date to push forward, only an hour, so this is the
 * hour-only form of `whenToDeliver`: an hour inside the window becomes the hour
 * the window ends. Same rule, same reason, and stated separately rather than
 * derived from a Date so that a caller scheduling a daily trigger cannot
 * accidentally pin it to today's calendar.
 */
export function hourToDeliver(hour: number, category: NotifyCategory, prefs: NotifyPrefs): number {
  const def = categoryDef(category);
  if (!def?.quietable || !prefs.quiet) return hour;
  return inQuietHours(hour, prefs) ? prefs.quietToHour : hour;
}

/* ── why a shifted reminder does not land on the top of the hour ───────────
 *
 * Everything moved out of quiet hours used to be set to `quietToHour, 0, 0, 0`
 * — the same instant, to the millisecond, for every reminder in the window.
 * src/lib/reminderPlan.ts emits a hydration nudge on the hour for every step of
 * its window, so a 22:00 and a 23:00 reminder both became 07:00:00.000, as did
 * any fixed reminder set on the hour. The OS collapses simultaneous banners, so
 * the member got one and lost the rest — the shift exists so a nudge is never
 * dropped, and stacking is how it dropped them anyway.
 *
 * So the window is mapped ONTO the ending hour, monotonically: a reminder's
 * position through quiet hours becomes its minute past `quietToHour`. Order is
 * preserved — a 22:00 nudge still arrives before a 23:00 one — and everything
 * still lands inside the first hour the member is awake.
 *
 * It is not injective and cannot be: a ten-hour window has 600 minutes in it
 * and there are 60 to land on. Two reminders within about ten minutes of each
 * other in the night still share a minute. That is a far smaller collapse than
 * every reminder in the window sharing one instant, and the honest description
 * of the guarantee is "order kept, spread out", not "never collides".
 */

/** Minutes from the start of quiet hours to `hour:minute`, wrapping midnight. */
function intoQuiet(hour: number, minute: number, prefs: NotifyPrefs): number {
  const from = prefs.quietFromHour * 60;
  const at = hour * 60 + minute;
  return at >= from ? at - from : at + 24 * 60 - from;
}

/** How long quiet hours run, in minutes. Never zero: `inQuietHours` already
 *  treats a zero-length window as no quiet hours at all. */
function quietLengthMinutes(prefs: NotifyPrefs): number {
  const from = prefs.quietFromHour * 60;
  const to = prefs.quietToHour * 60;
  return to > from ? to - from : to + 24 * 60 - from;
}

/**
 * The minute past `quietToHour` a reminder due at `hour:minute` should take.
 *
 * 0–59, monotonic in the reminder's position through the window, so the first
 * thing due in the night is the first thing delivered in the morning.
 */
export function deliveryMinute(hour: number, minute: number, prefs: NotifyPrefs): number {
  const len = quietLengthMinutes(prefs);
  if (len <= 0) return 0;
  const into = Math.max(0, Math.min(len, intoQuiet(hour, minute, prefs)));
  if (len <= 60) return Math.min(59, into);
  return Math.min(59, Math.round((into / len) * 59));
}

/**
 * The hour AND minute a repeating reminder should fire at.
 *
 * The full form of `hourToDeliver`, which answers with an hour and therefore
 * could only ever put everything on the top of it.
 */
export function timeToDeliver(
  hour: number,
  minute: number,
  category: NotifyCategory,
  prefs: NotifyPrefs,
): { hour: number; minute: number } {
  const def = categoryDef(category);
  if (!def?.quietable || !prefs.quiet || !inQuietHours(hour, prefs)) return { hour, minute };
  return { hour: prefs.quietToHour, minute: deliveryMinute(hour, minute, prefs) };
}

/**
 * What to tell somebody who has just typed a time inside their own quiet hours,
 * or null when the time they typed is the time it will arrive.
 *
 * The reminders screen echoed the typed time back beside the box and said
 * nothing, so a member who set a supplement reminder for 11pm found out it was
 * a morning reminder by never being reminded at night.
 */
export function movedNote(
  hour: number,
  minute: number,
  category: NotifyCategory,
  prefs: NotifyPrefs,
  label: (h: number, m: number) => string,
): string | null {
  const out = timeToDeliver(hour, minute, category, prefs);
  if (out.hour === hour && out.minute === minute) return null;
  return `That is inside your quiet hours (${quietLabel(prefs)}), so this one will arrive at ${label(out.hour, out.minute)} instead. Nothing is dropped — it waits.`;
}

/** "10pm to 7am" — for the sentence under the switch. Sentence case, no stop. */
export function quietLabel(prefs: NotifyPrefs): string {
  const h = (n: number) => {
    const suffix = n < 12 ? 'am' : 'pm';
    const twelve = n % 12 === 0 ? 12 : n % 12;
    return `${twelve}${suffix}`;
  };
  return `${h(prefs.quietFromHour)} to ${h(prefs.quietToHour)}`;
}
