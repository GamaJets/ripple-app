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
// Pure — no react, no storage, no notifications module — so the rules are
// assertable without a phone.

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
    note: 'Messages, notices and invoices. These are sent from the server, so they follow the single Push Notifications switch rather than this list.',
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
  const h = Math.floor(hour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return false;
  const from = prefs.quietFromHour, to = prefs.quietToHour;
  if (from === to) return false;
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
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
  out.setHours(prefs.quietToHour, 0, 0, 0);
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

/** "10pm to 7am" — for the sentence under the switch. Sentence case, no stop. */
export function quietLabel(prefs: NotifyPrefs): string {
  const h = (n: number) => {
    const suffix = n < 12 ? 'am' : 'pm';
    const twelve = n % 12 === 0 ? 12 : n % 12;
    return `${twelve}${suffix}`;
  };
  return `${h(prefs.quietFromHour)} to ${h(prefs.quietToHour)}`;
}
