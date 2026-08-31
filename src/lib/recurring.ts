// A standing appointment, and the one rule that must never be got wrong.
//
// ── What a series is ──────────────────────────────────────────────────────
//
// `supabase/parts/135-a-standing-appointment.sql` stores the ARRANGEMENT —
// this client, this coach, this weekday, this local time, this zone — and a
// daily job writes it out as ordinary rows in `sessions` eight weeks ahead.
// Nobody re-taps Generate. An occurrence is a booked session in every respect
// the rest of the product cares about, which is why the waitlist, the notice
// window and the fee all keep working on one without knowing what a series is.
//
// ── The rule this file exists for ─────────────────────────────────────────
//
// CANCELLING ONE OCCURRENCE AND ENDING THE SERIES ARE DIFFERENT ACTIONS WITH
// DIFFERENT PRICES, AND THE APP MUST OFFER THEM SEPARATELY.
//
// Cancelling one occurrence is an ordinary cancellation. It goes through
// `cancel_my_session` (part 126), it frees the slot, it hands it to whoever is
// first on its waitlist, and if it is inside the coach's notice window it puts
// ONE late-cancellation fee on the record. That is correct and it is what
// should happen when somebody cannot make next Tuesday.
//
// Ending the series is not a cancellation at all. It removes the future
// occurrences that only exist because of the arrangement, and it CHARGES
// NOTHING, whatever the notice window says. The implementation that would
// charge is the obvious one — loop the occurrences, cancel each — and it bills
// somebody a late fee for every session in the horizon, which after a while on
// a year-long arrangement is a year of fees for a decision taken two months in
// advance. `end_session_series` does not go near `cancel_my_session`, and
// `cancelOptions` below is the screen-side statement of the same fact.
//
// The next occurrence — the one that may be inside the notice window right now
// — deliberately STAYS BOOKED when a series ends. "We'll stop after next
// Tuesday" is what ending a standing appointment means to the two people in it.
// If they also cannot make that last one, they cancel that one session through
// the ordinary button and the ordinary policy prices it: one session, one
// decision, one fee at most.
import {
  insideNoticeWindow, lateCancelFee, noticeHoursOf, noticeLabel,
  feeAmountLine, type CancellationPolicy, type FeeVerdict,
} from './booking';

/** Sunday-first, matching `extract(dow)` in Postgres and `Date.getDay()`, so
 *  nothing anywhere has to translate between two conventions. */
export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Quarter hours, the same grid `trainer_availability.minute` uses and the same
 *  grid `session_series_minute_chk` enforces. */
export const SERIES_MINUTES = [0, 15, 30, 45];

/** How far ahead the server writes occurrences. Stated here so a screen can say
 *  it rather than describe a horizon nobody chose. Must match the default on
 *  `run_session_series_materialiser`. */
export const SERIES_HORIZON_DAYS = 56;

/** A row of `my_session_series()`, exactly as PostgREST hands it over. */
export interface RawSeries {
  id: string;
  trainer_id: string;
  client_id: string;
  client_name: string | null;
  dow: number;
  hour: number;
  minute: number;
  duration_min: number;
  tz: string;
  starts_on: string;
  ends_on: string | null;
  status: string;
  upcoming: number | null;
  next_at: string | null;
}

/** The same arrangement, in the shape the screens read. */
export interface RecurringSeries {
  id: string;
  trainerId: string;
  clientId: string;
  /** The coach sees who it is with; a client reading their own arrangement is
   *  handed null rather than their own name. */
  clientName: string | null;
  dow: number;
  hour: number;
  minute: number;
  durationMin: number;
  tz: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  /** Booked occurrences still to come. Zero is a real answer for an ended
   *  series and for one whose every occurrence has been cancelled singly. */
  upcoming: number;
  /** When the next one is, or null when there is not one. */
  nextAt: string | null;
}

const num = (v: unknown, fallback: number): number => {
  // Postgres `int` arrives as a number through PostgREST, but `count(*)::int`
  // inside a definer function has come back as a string here before, and
  // Number(null) === 0 is a live hazard on a field a screen prints.
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Server rows into screen rows: active ones first, then by when in the week
 *  they fall. One ordering, written once, because a coach's list and a client's
 *  list are the same list read from two ends. */
export function shapeSeries(rows: RawSeries[] | null | undefined): RecurringSeries[] {
  if (!rows || !rows.length) return [];
  return rows
    .map((r) => ({
      id: String(r.id),
      trainerId: String(r.trainer_id),
      clientId: String(r.client_id),
      clientName: typeof r.client_name === 'string' && r.client_name.trim() ? r.client_name.trim() : null,
      dow: num(r.dow, 0),
      hour: num(r.hour, 0),
      minute: num(r.minute, 0),
      durationMin: num(r.duration_min, 60),
      tz: typeof r.tz === 'string' ? r.tz : '',
      startsOn: String(r.starts_on),
      endsOn: r.ends_on ? String(r.ends_on) : null,
      active: r.status === 'active',
      upcoming: num(r.upcoming, 0),
      nextAt: r.next_at ? String(r.next_at) : null,
    }))
    .sort((a, b) =>
      Number(b.active) - Number(a.active) || a.dow - b.dow || a.hour - b.hour || a.minute - b.minute);
}

/** "7:00 am", "6:45 pm". Built here rather than with toLocaleTimeString because
 *  the hour on a series is a wall-clock hour in the SERIES' zone, not in the
 *  reader's, and a Date would drag the reader's zone into it. */
export function clockLabel(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(Math.max(0, Math.min(59, Math.trunc(minute)))).padStart(2, '0');
  return `${h12}:${mm} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "Every Tuesday at 7:00 am". The whole arrangement in one line. */
export function seriesLabel(s: Pick<RecurringSeries, 'dow' | 'hour' | 'minute'>): string {
  const day = DOW_NAMES[((s.dow % 7) + 7) % 7];
  return `Every ${day} at ${clockLabel(s.hour, s.minute)}`;
}

/**
 * The dates a series WOULD fall on, for the preview a coach sees before they
 * agree to it.
 *
 * This is the reader's local clock, deliberately: it is a preview drawn on the
 * phone of the person setting the series up, and the zone they are standing in
 * is the zone the app sends as `p_tz`. The authoritative dates are the server's
 * — `_materialise_session_series` computes `(date + time) at time zone tz`, so
 * seven in the morning survives a daylight-saving change that this preview,
 * built from local Dates, gets right for the same reason: it sets the hour on
 * each date rather than adding seven days of seconds to the last one.
 */
export function seriesDates(dow: number, hour: number, minute = 0, weeks = 8, from = new Date()): Date[] {
  const out: Date[] = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const target = ((dow % 7) + 7) % 7;
  // Roll forward to the first matching weekday, then step a week at a time —
  // by DATE, not by elapsed milliseconds.
  const offset = (target - base.getDay() + 7) % 7;
  for (let w = 0; w < Math.max(0, weeks); w++) {
    const cand = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset + w * 7);
    cand.setHours(hour, minute, 0, 0);
    if (cand.getTime() > from.getTime()) out.push(cand);
  }
  return out;
}

/* ── One occurrence, or the whole arrangement ─────────────────────────────── */

export type CancelScope = 'occurrence' | 'series';

/** One of the two things somebody can do to a standing appointment. */
export interface CancelOption {
  scope: CancelScope;
  /** The button. */
  label: string;
  /** What confirming it does, said before they confirm it. */
  detail: string;
  /**
   * Whether confirming this can put money on the record.
   *
   * FALSE for 'series', always, under every policy and every notice window.
   * That is not a default and not a convenience — it is the rule the whole
   * feature turns on, and `end_session_series` returns `charged: false` as a
   * stated fact for the same reason.
   */
  charges: boolean;
  /** The fee verdict for the one session. Null for 'series', because ending an
   *  arrangement has no fee to have a verdict about. */
  verdict: FeeVerdict | null;
  /** How many booked sessions confirming it affects. Exactly 1 for
   *  'occurrence' — never the size of the series. */
  affects: number;
}

/**
 * The two choices, priced.
 *
 * `upcoming` is the count the SERVER reports for the series (`my_session_series`),
 * not something counted on the device, because a screen holding a capped read
 * would understate how much a coach is about to remove.
 */
export function cancelOptions(o: {
  startsAt: string;
  policy: CancellationPolicy | null | undefined;
  upcoming: number;
  now?: number;
}): CancelOption[] {
  const now = o.now ?? Date.now();
  const notice = noticeHoursOf(o.policy);
  const inside = insideNoticeWindow(o.startsAt, notice, now);
  const verdict = lateCancelFee(o.policy, inside);

  // A fee is on the record only when the server would write one, and the server
  // writes one only when the policy applies AND names an amount. 'unpriced' and
  // 'unknown' are inside the window with no row to follow, and the sentence for
  // each says so rather than quoting a figure nobody chose.
  let charges = false;
  if (verdict.kind === 'fee') charges = true;

  // The other one, and it is not the same shape. `charges` is a literal here
  // rather than anything derived from `inside`, `notice` or `verdict`: the
  // moment ending a series consults the notice window, ending a year-long
  // arrangement two months out starts pricing sessions nobody cancelled.
  const later = Math.max(0, o.upcoming - 1);

  return [
    {
      scope: 'occurrence',
      label: 'Cancel this session only',
      detail: occurrenceDetail(verdict, notice),
      charges,
      verdict,
      affects: 1,
    },
    {
      scope: 'series',
      label: 'End the standing appointment',
      detail: seriesDetail(later, o.startsAt),
      charges: false,
      verdict: null,
      affects: later,
    },
  ];
}

/** What cancelling the one session does, in the words shown before confirming. */
export function occurrenceDetail(v: FeeVerdict, noticeHours: number): string {
  const w = noticeLabel(noticeHours);
  switch (v.kind) {
    case 'in-time':
      return `Frees this one only — the rest of the standing appointment is untouched. This is more than ${w} away, so no fee applies.`;
    case 'no-policy':
      return 'Frees this one only — the rest of the standing appointment is untouched. Your coach doesn’t charge for a late cancellation.';
    case 'unknown':
      return `Frees this one only — the rest of the standing appointment is untouched. This is inside ${w} and we couldn’t read your coach’s policy, so we can’t say whether a fee applies.`;
    case 'unpriced':
      return `Frees this one only — the rest of the standing appointment is untouched. This is inside ${w}, so your coach’s policy applies; they haven’t set an amount, so ask them.`;
    case 'fee':
      return `Frees this one only — the rest of the standing appointment is untouched. This is inside ${w}, so a late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} is recorded. Repple doesn’t take this payment.`;
  }
}

/**
 * What ending the arrangement does. Every branch says what it costs, because
 * the whole point is that it costs nothing.
 *
 * `nextStartsAt` is not printed — it is read only for whether there IS a next
 * occurrence, and that is what it is here for. The sentence used to end with
 * "The next session stays booked — cancel that one separately" unconditionally,
 * including on an arrangement with NOTHING on the books at all: no next
 * Tuesday, nothing to cancel separately, and a member sent looking for a
 * session that does not exist. An empty string, a null and an unparseable
 * value all mean the same thing — the caller could not name a next occurrence
 * — and none of them may be reported as one.
 */
export function seriesDetail(later: number, nextStartsAt: string | null | undefined): string {
  const hasNext = typeof nextStartsAt === 'string' && nextStartsAt.trim().length > 0
    && Number.isFinite(Date.parse(nextStartsAt));
  const keeps = ' The next session stays booked — cancel that one separately if you need to.';
  if (later <= 0) {
    return hasNext
      ? `Stops it repeating. There are no sessions after this one on the books, so nothing is removed and nothing is charged.${keeps}`
      : 'Stops it repeating. There are no sessions on the books at all, so nothing is removed and nothing is charged.';
  }
  const n = later === 1 ? '1 later session' : `${later} later sessions`;
  return `Stops it repeating and removes ${n} from both calendars. No cancellation fee is charged for any of them, however close they are.${hasNext ? keeps : ''}`;
}

/** The whole of the promise, in one sentence a test can hold the app to. */
export const RECURRING_END_RULE =
  'Ending a standing appointment removes the sessions after the next one and never charges a cancellation fee, '
  + 'however much notice is left. The next session stays booked; cancel that one on its own if you need to, '
  + 'and your coach’s notice policy applies to that session alone.';

/** Why eight weeks of Tuesdays do not empty a ten-session pack. */
export const RECURRING_CREDIT_NOTE =
  'A standing appointment books the time, not the sessions. It doesn’t draw credits from a session pack in '
  + 'advance — your coach settles what’s owed with you, the same as any other session.';

/** What happens to a date the coach was already busy on. */
export const RECURRING_CLASH_NOTE =
  'A date you were already booked or blocked on is skipped rather than double-booked. The rest of the '
  + 'arrangement is unaffected, and the skipped dates are listed so you can place them by hand.';

/**
 * The sentence about the dates that did not take.
 *
 * Null when nothing clashed, because "0 dates were skipped" is a line no screen
 * should ever draw. `dates` are ISO days as the server returned them; they are
 * printed as given rather than re-parsed into a Date, which would drag the
 * reader's zone across a date the series stated in its own.
 */
export function clashLine(skipped: number, dates: string[] | null | undefined): string | null {
  if (!Number.isFinite(skipped) || skipped <= 0) return null;
  const list = (dates ?? []).filter((d) => typeof d === 'string' && d.length > 0);
  const n = skipped === 1 ? '1 date was skipped' : `${skipped} dates were skipped`;
  return list.length
    ? `${n} because you were already booked then: ${list.join(', ')}. Everything else was created.`
    : `${n} because you were already booked then. Everything else was created.`;
}

/** What was created, said honestly. Null when nothing happened at all, so a
 *  screen does not announce a success it did not have. */
export function createdLine(created: number, weeks = SERIES_HORIZON_DAYS / 7): string | null {
  if (!Number.isFinite(created) || created <= 0) return null;
  const n = created === 1 ? '1 session' : `${created} sessions`;
  return `${n} booked, covering the next ${Math.round(weeks)} weeks. It keeps going from there on its own.`;
}
