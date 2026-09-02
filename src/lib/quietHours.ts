// "Not at eleven at night" — the coach's half, which the server has to apply.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// supabase/parts/251 gave a coach five per-channel switches and no time
// dimension. The complaint those switches came from was "this arrives at eleven
// at night", and the only answer the product had was to mute client messages
// for ever — which is not what anybody wanted. A coach wants their clients to
// be able to message them; they want the phone quiet while they sleep. Same
// notification, two different hours, and nothing anywhere could say so.
//
// ── WHY THIS IS NOT `notifyPrefs.inQuietHours` ────────────────────────────
//
// src/lib/notifyPrefs.ts has quiet hours already and they work, for the member,
// for the notifications THIS APP SCHEDULES. That file is scrupulous about the
// limit: `CategoryDef.local` is the line, and it says on the screen that remote
// notifications follow the single switch instead.
//
// Every coach-directed notification is remote. Some are sent by a client's
// handset, the rest by a trigger or an edge function, and the gate has to be
// where the recipients are resolved — on a server that has never been told what
// hour it is where the coach is. So a device-local quiet-hours switch on the
// coach app would read "quiet" while the phone buzzed, which is the shape of
// bug src/lib/pushConsent.ts exists for.
//
// Two things follow, and they are the whole design:
//
//   · THE ZONE IS CARRIED. `tz` is an IANA name from this device, stored beside
//     the window in `notify_quiet_hours` (part 530), and the hour arithmetic is
//     done in Postgres against its own timezone database. Nothing in JavaScript
//     computes anybody's local hour — an edge function's `getHours()` is the
//     hour in the function's region, which is the one hour certain to be wrong
//     for everybody, and a stored UTC offset is right until the clocks change.
//
//   · A HELD PUSH IS NOT A DELAYED ONE. The member's version SHIFTS a
//     notification to the end of the window, because it holds a scheduled
//     trigger it can move. A push already handed to Expo is not a thing this
//     system can hold, so the coach's version suppresses and the record stays —
//     the notifications row is written before send-push is ever called. Saying
//     "you'll get it at seven" would be promising a delivery nothing performs.
//
// ── AND WHY THE SCREEN MAY REFUSE TO OFFER IT ─────────────────────────────
//
// The filter is inert until supabase/functions/send-push and notify-message are
// redeployed to read the view. A quiet-hours switch the server does not apply
// is worse than no quiet hours: the coach stops expecting the 11pm ping, gets
// it anyway, and concludes the app's settings do nothing. So part 530 ships a
// rollout row that says whether those functions are live, and
// `quietAvailability` below is what turns that into either a control or a
// sentence. Neither state guesses: unread is its own answer.
//
// Pure — no react, no supabase, no notifications module.

/** The wrap rule, in one place.
 *
 * `from < to` is an ordinary window; otherwise it crosses midnight and 22 → 7
 * means 22, 23, 0, 1 … 6. `to` is EXCLUSIVE in both, which is why 22 → 7 is
 * silent through 06:59 and not through 07:59.
 *
 * `from === to` is a zero-length window and returns false. The database refuses
 * to store one (part 530) and NotifyPrefs treats it the same way; this is the
 * shared arithmetic both of them lean on, so the two can never disagree about
 * an hour and cost somebody an hour of sleep.
 */
export function hourInWindow(hour: number, fromHour: number, toHour: number): boolean {
  const h = Math.floor(hour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return false;
  if (fromHour === toHour) return false;
  return fromHour < toHour ? (h >= fromHour && h < toHour) : (h >= fromHour || h < toHour);
}

/** A coach's window, as `notify_quiet_hours` stores it. */
export interface QuietHours {
  /** 0–23, inclusive — quiet begins at the top of this hour. */
  fromHour: number;
  /** 0–23, EXCLUSIVE — quiet ends at the top of this hour. */
  toHour: number;
  /** The IANA zone the two hours are read in. Stored rather than derived,
   *  because quiet hours are a fact about where somebody sleeps and nothing
   *  else in this database records that. */
  tz: string;
}

/**
 * The window a coach is offered when they turn this ON.
 *
 * NOT a default in the sense NotifyPrefs refuses: nothing is stored until the
 * coach acts, no row means no quiet hours, and this is never written on their
 * behalf. It is the starting position of a control somebody has just reached
 * for, which is a different thing from an answer invented for somebody who has
 * never opened the screen.
 */
export const SUGGESTED_QUIET: Readonly<Pick<QuietHours, 'fromHour' | 'toHour'>> = { fromHour: 22, toHour: 7 };

/**
 * This device's IANA zone, or null.
 *
 * Null is a real outcome and the caller must not paper over it: a build where
 * `Intl` reports nothing usable cannot honestly store a zone, and storing UTC
 * instead would make a London coach's 10pm land at 11pm for half the year and
 * a Los Angeles coach's at 3pm. Better to say the zone could not be read and
 * offer nothing.
 */
export function deviceZone(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === 'string' && z.trim() && z.includes('/') ? z : null;
  } catch {
    return null;
  }
}

/**
 * One stored row → a window, or null.
 *
 * Null for anything that is not a complete, in-range, non-zero-length answer.
 * A half-valid row is not a preference and reading one as a window would
 * silence somebody's notifications on the strength of a bad write.
 */
export function quietFromRow(row: { from_hour?: unknown; to_hour?: unknown; tz?: unknown } | null | undefined): QuietHours | null {
  if (!row) return null;
  const hour = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  const from = hour(row.from_hour);
  const to = hour(row.to_hour);
  const tz = typeof row.tz === 'string' ? row.tz.trim() : '';
  if (from === null || to === null || from === to || !tz) return null;
  return { fromHour: from, toHour: to, tz };
}

/** Whether `hour` in the coach's own zone falls inside their window. The screen
 *  uses it for the preview; the SERVER is what actually applies it, in
 *  `notify_quiet_now`, and this must agree with that view's CASE. */
export function inQuiet(hour: number, q: QuietHours | null): boolean {
  if (!q) return false;
  return hourInWindow(hour, q.fromHour, q.toHour);
}

/** "10pm", "7am", "12 midday". Lower case, for the middle of a sentence. */
export function hourLabel(h: number): string {
  const n = Math.max(0, Math.min(23, Math.floor(h)));
  if (n === 0) return 'midnight';
  if (n === 12) return 'midday';
  const suffix = n < 12 ? 'am' : 'pm';
  return `${n % 12}${suffix}`;
}

/** "10pm to 7am". Sentence case, no full stop. */
export function windowLabel(q: QuietHours): string {
  return `${hourLabel(q.fromHour)} to ${hourLabel(q.toHour)}`;
}

/* ── whether the control may exist at all ──────────────────────────────────── */

export interface QuietAvailability {
  /** True only when the server is known to apply this. */
  available: boolean;
  /** What to say instead of a switch. Null when the switch may be drawn. */
  note: string | null;
}

/**
 * Whether this build's server actually applies quiet hours.
 *
 * Three answers and they are three different sentences, because a coach who is
 * told the wrong one acts on it:
 *
 *   enforced      the two edge functions have been deployed reading the view.
 *                 Draw the control.
 *   not enforced  the SQL is applied and the functions are not. Say so. A
 *                 switch here would be a coach turning something on and being
 *                 buzzed at 11pm anyway, after which they will not trust the
 *                 rest of this screen either.
 *   unread        the rollout row could not be read. NOT "not enforced" — this
 *                 says the app could not find out, and it says it in those
 *                 words, because "your server does not support this" is a claim
 *                 about somebody's installation made from a failed select.
 */
export function quietAvailability(enforced: boolean | null): QuietAvailability {
  if (enforced === true) return { available: true, note: null };
  if (enforced === false) {
    return {
      available: false,
      note:
        'Quiet hours are not switched on for this server yet. The part that holds them back is not in the app — it '
        + 'is the piece that decides who gets a notification, and it has to be updated before a quiet hour would '
        + 'stop anything. Rather than give you a switch that does nothing, there is no switch until it is. Your '
        + 'category switches above are unaffected and still work.',
    };
  }
  return {
    available: false,
    note:
      'Whether this server applies quiet hours could not be read, so nothing is offered here. That is a read that '
      + 'failed rather than an answer — open this again once you have signal.',
  };
}

/* ── what the screen says once the control exists ──────────────────────────── */

/** What a quiet hour does and does not do. The distinction that makes it safe
 *  to offer: nothing is lost, and nothing arrives later either. */
export const QUIET_HELD_NOT_DELAYED =
  'Inside these hours your phone stays quiet. The notification is still written into your notifications list, so '
  + 'nothing is lost — but it is not held back and delivered in the morning either. You find it when you open the '
  + 'app, the same as a category you have muted.';

/** That the zone is the one stored, not the one the phone is in now. */
export const QUIET_ZONE_NOTE =
  'These hours are read in the timezone your phone was in when you set them, because the notification is sent from '
  + 'a server rather than by this handset. Set them again after you move and they follow you.';

/** That the master switch and the categories still outrank this. */
export const QUIET_ORDER_NOTE =
  'This sits on top of everything above it. A category you have muted stays muted at every hour, and with Push '
  + 'Notifications off nothing arrives whatever these hours say.';

/**
 * That the coach is somewhere else now.
 *
 * Null when the zones agree or when either is unknown — a sentence about a
 * zone we could not read would be an alarm raised by a failure. Said when they
 * differ because the consequence is concrete and invisible: a coach who set
 * 10pm in London and is now in Dubai is silent from 2am local, and nothing on
 * the screen would otherwise explain why the phone went off at midnight.
 */
export function zoneMovedNote(stored: string | null | undefined, device: string | null | undefined): string | null {
  if (!stored || !device || stored === device) return null;
  return `You set these in ${stored} and this phone is now in ${device}, so they are being applied ${stored} time. `
    + 'Save them again to move them to where you are.';
}
