// What a member's reminder settings actually schedule.
//
// ── The two defects this closes ────────────────────────────────────────────
//
// 1. HYDRATION AND SUPPLEMENTS, DAILY, AND NOTHING ELSE. No training reminder,
//    no weigh-in, no progress photo, and no way to say "weekdays only" about
//    any of them — so a member training Monday, Wednesday and Friday either got
//    nudged on the four days they were not training or got nothing.
//
// 2. THEY WERE SCHEDULED ONLY AT THE MOMENT SAVE WAS PRESSED. The reminders
//    screen said so about itself: "nothing anywhere re-schedules them from the
//    saved payload later". So a member who set reminders on a build that could
//    not schedule anything got nothing after the build that could, for as long
//    as they never went back to the screen — while the alert they had been
//    shown promised the opposite. A reinstall lost them the same way.
//
// The fix for the second is that this module turns the SAVED PAYLOAD into the
// list of things to schedule, so the screen and the launch-time resync
// (src/ui/reminderSync.tsx) compute the same list from the same stored answer.
// Two copies of that derivation is how the screen and the resync end up
// scheduling different reminders — the shape this codebase keeps re-finding.
//
// Pure: no notifications module, no storage, no React.

/**
 * Weekdays as expo-notifications counts them: 1 = Sunday … 7 = Saturday.
 *
 * NOT JavaScript's 0–6. The two differ by one, nothing warns about it, and a
 * reminder set for Monday that fires on Sunday is the kind of bug somebody
 * reports as "the app woke me up on my rest day". The convention is named here,
 * once, and `EVERY_DAY` below is the only literal list in the codebase.
 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const EVERY_DAY: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
/** Monday to Friday, in the same 1 = Sunday convention. */
export const WEEKDAYS_ONLY: readonly Weekday[] = [2, 3, 4, 5, 6];

/** Short labels for the day picker, index 0 unused so `DAY_LABEL[w]` works. */
export const DAY_LABEL: readonly string[] = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One reminder the member set up themselves. */
export interface CustomReminder {
  id: string;
  /** What it is for, in their words. Becomes the notification's title. */
  name: string;
  hour: number;
  minute: number;
  /** Which days. Empty means the reminder is off — see `plannedReminders`. */
  days: Weekday[];
}

/**
 * The three reminders the app names itself, because they are the three the
 * product has an opinion about and asking somebody to type "Weigh in" is
 * asking them to do our work.
 *
 * Each is off until switched on. Nothing here is defaulted to a time: a
 * training reminder at an hour nobody chose is the "10,000 steps" mistake in a
 * different costume.
 */
export type FixedKind = 'training' | 'weighin' | 'photo';

export interface FixedReminder {
  on: boolean;
  hour: number;
  minute: number;
  days: Weekday[];
}

export const FIXED_LABEL: Record<FixedKind, { title: string; body: string; route: string }> = {
  training: {
    title: 'Time to train',
    body: 'Your session is waiting. Even a short one keeps the week honest.',
    route: '/(client)/workouts',
  },
  weighin: {
    title: 'Weigh-in',
    body: 'Step on the scale and log it — one reading a week is enough to see a trend.',
    route: '/(client)/scans',
  },
  photo: {
    title: 'Progress photo',
    body: 'Same spot, same light, same time of day. That is what makes them comparable.',
    route: '/(client)/scans',
  },
};

/** What the reminders screen stores, in full. */
export interface SavedReminders {
  hydration: boolean;
  /** Hours between hydration nudges. */
  every: number;
  startH: number;
  endH: number;
  /** Which days hydration nudges run. */
  hydrationDays: Weekday[];
  supps: CustomReminder[];
  fixed: Partial<Record<FixedKind, FixedReminder>>;
  /** The notification ids last scheduled, so they can be cancelled as a set. */
  ids: string[];
}

export const EMPTY_SAVED: SavedReminders = {
  hydration: true,
  every: 3,
  startH: 9,
  endH: 21,
  hydrationDays: [...EVERY_DAY],
  supps: [],
  fixed: {},
  ids: [],
};

const isWeekday = (v: unknown): v is Weekday =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7;

const hour = (v: unknown, fallback: number) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback);
const minute = (v: unknown, fallback: number) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 59 ? v : fallback);

/**
 * The stored blob → settings, validated field by field.
 *
 * Never throws and never returns null. It also MIGRATES the older shape, which
 * had no `days` and no `fixed` at all: a reminder stored before this existed
 * was daily, so an absent day list becomes every day rather than none. Reading
 * it as none would silently switch off every reminder every existing member has
 * — the worst possible outcome for a change whose entire purpose is that
 * reminders survive.
 */
export function savedFromStored(raw: string | null | undefined): SavedReminders {
  if (raw == null) return EMPTY_SAVED;
  let p: any;
  try { p = JSON.parse(raw); } catch { return EMPTY_SAVED; }
  if (!p || typeof p !== 'object') return EMPTY_SAVED;

  const days = (v: unknown): Weekday[] => {
    if (!Array.isArray(v)) return [...EVERY_DAY];
    const out = v.filter(isWeekday);
    // A stored EMPTY array is an answer — "no days", i.e. off — and must not be
    // turned back into every day. Only an ABSENT list migrates.
    return out;
  };

  const supps: CustomReminder[] = Array.isArray(p.supps)
    ? p.supps.flatMap((s: any) => {
        const name = typeof s?.name === 'string' ? s.name.trim() : '';
        if (!name) return [];
        return [{
          id: typeof s?.id === 'string' && s.id ? s.id : `r_${name}`,
          name,
          hour: hour(s?.hour, 8),
          minute: minute(s?.minute, 0),
          days: s?.days === undefined ? [...EVERY_DAY] : days(s.days),
        }];
      })
    : [];

  const fixed: Partial<Record<FixedKind, FixedReminder>> = {};
  for (const k of ['training', 'weighin', 'photo'] as FixedKind[]) {
    const f = p.fixed?.[k];
    if (!f || typeof f !== 'object') continue;
    fixed[k] = {
      on: f.on === true,
      hour: hour(f.hour, 18),
      minute: minute(f.minute, 0),
      days: f.days === undefined ? [...EVERY_DAY] : days(f.days),
    };
  }

  return {
    hydration: p.hydration !== false,
    every: [2, 3, 4].includes(p.every) ? p.every : EMPTY_SAVED.every,
    startH: hour(p.startH, EMPTY_SAVED.startH),
    endH: hour(p.endH, EMPTY_SAVED.endH),
    hydrationDays: p.hydrationDays === undefined ? [...EVERY_DAY] : days(p.hydrationDays),
    supps,
    fixed,
    ids: Array.isArray(p.ids) ? p.ids.filter((x: unknown) => typeof x === 'string') : [],
  };
}

/** One thing to schedule: a title, a body, days and a time. */
export interface PlannedReminder {
  /** Stable within one plan, so a test can name a row without an index. */
  key: string;
  title: string;
  body: string;
  route: string;
  days: Weekday[];
  hour: number;
  minute: number;
}

/**
 * Everything `saved` should schedule, in the order it will be scheduled.
 *
 * ── The rules, all of them about not inventing a reminder ─────────────────
 *
 *  · A reminder on NO DAYS produces nothing. An empty day list is an answer,
 *    and reading it as "every day" would set a reminder the member switched
 *    off one day at a time.
 *  · Hydration counts UP from the first hour to the last, so a window whose end
 *    is earlier than its start produces nothing — the screen says so beside the
 *    boxes while it can still be corrected, and this does not silently repair
 *    it into a window nobody asked for.
 *  · A fixed reminder that is off produces nothing, and its stored time is kept
 *    so switching it back on does not lose the hour they chose.
 *
 * The list is the ONLY thing that decides what gets scheduled, and both the
 * save handler and the launch-time resync read it — so the count the screen
 * reports and the reminders that actually exist cannot drift apart.
 */
export function plannedReminders(saved: SavedReminders): PlannedReminder[] {
  const out: PlannedReminder[] = [];

  if (saved.hydration && saved.hydrationDays.length && saved.endH >= saved.startH) {
    const step = Math.max(1, saved.every);
    for (let h = saved.startH; h <= saved.endH; h += step) {
      out.push({
        key: `hydration-${h}`,
        title: 'Time to hydrate',
        body: 'Sip some water — small and often keeps you on target.',
        route: '/(client)/recovery',
        days: [...saved.hydrationDays],
        hour: h,
        minute: 0,
      });
    }
  }

  for (const k of ['training', 'weighin', 'photo'] as FixedKind[]) {
    const f = saved.fixed[k];
    if (!f?.on || !f.days.length) continue;
    const l = FIXED_LABEL[k];
    out.push({ key: `fixed-${k}`, title: l.title, body: l.body, route: l.route, days: [...f.days], hour: f.hour, minute: f.minute });
  }

  for (const s of saved.supps) {
    if (!s.days.length) continue;
    out.push({
      key: `supp-${s.id}`,
      // The member's own words as the title, so the banner says the thing they
      // wrote rather than "Reminder".
      title: s.name,
      body: `Reminder: ${s.name}`,
      route: '/(client)/reminders',
      days: [...s.days],
      hour: s.hour,
      minute: s.minute,
    });
  }

  return out;
}

/**
 * How many individual notifications a plan needs.
 *
 * One per reminder PER DAY, because expo-notifications has no "these days"
 * trigger — it has `weekly`, which fires on one weekday. A member with a
 * Monday/Wednesday/Friday training reminder has three scheduled notifications
 * behind one row on the screen, and the screen's "you'll get N reminders" has
 * to count the rows rather than the notifications or it reads as nonsense.
 */
export function plannedNotificationCount(plan: readonly PlannedReminder[]): number {
  return plan.reduce((a, p) => a + p.days.length, 0);
}

/** "Every day", "Weekdays", "Mon, Wed, Fri" — for the row on the screen. */
export function daysLabel(days: readonly Weekday[]): string {
  if (!days.length) return 'Off';
  if (days.length === 7) return 'Every day';
  const set = new Set(days);
  if (set.size === 5 && WEEKDAYS_ONLY.every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(1) && set.has(7)) return 'Weekends';
  // Monday first, because a week that starts on Sunday reads as a bug to most
  // of the world and the underlying numbering is not the member's problem.
  const order: Weekday[] = [2, 3, 4, 5, 6, 7, 1];
  return order.filter((d) => set.has(d)).map((d) => DAY_LABEL[d]).join(', ');
}
