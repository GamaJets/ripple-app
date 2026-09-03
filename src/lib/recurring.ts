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
  feeAmountLine, unstatedCurrency, type CancellationPolicy, type FeeVerdict,
} from './booking';
import { fmtClock, weekdayName } from './format';

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
 * The same arrangement, written in the READER'S language and clock.
 *
 * `seriesLabel` above is English and 12-hour by construction, and it was the
 * title of every row on app/(client)/standing.tsx, the subject of the pause
 * confirmation, of the end confirmation and of the "ended" alert — directly
 * above "Next Tue 09:00", which the same screen renders through the app's own
 * locale formatters. So a member in Milan read their own clock on one line and
 * an English "Every Tuesday at 7:00 am" on the line above it, about the same
 * arrangement.
 *
 * The hour is NOT converted: it is a wall-clock hour in the SERIES' zone, which
 * is the argument `clockLabel` makes and it is right. `fmtClock` takes the hour
 * and the minute as numbers for exactly this reason — it never touches a zone —
 * so what changes is the writing, not the time.
 *
 * `seriesLabel` stays because the coach's screens and the tests are written on
 * it, and because a series belongs to the coach's own diary where their wording
 * is the one on the invoice.
 */
export function memberSeriesLabel(s: Pick<RecurringSeries, 'dow' | 'hour' | 'minute'>): string {
  return `Every ${weekdayName(s.dow)} at ${fmtClock(s.hour, s.minute)}`;
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

/* ── Which booked sessions belong to THIS arrangement ─────────────────────── */

/**
 * The weekday, hour and minute an instant falls on IN A NAMED ZONE.
 *
 * Null when the zone cannot be read — a bad `tz` string, or a runtime without
 * ICU. Null is a refusal, not a default: the caller below widens rather than
 * narrows on it, because filtering with a zone we could not apply would hide
 * real sessions from a preview about somebody's money.
 */
export function zonedSlot(iso: string, tz: string): { dow: number; hour: number; minute: number } | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  try {
    // No locale is named, and none is wanted: this is a PARSE, not a sentence.
    // `numberingSystem: 'latn'` so the parts are digits `Number()` can read on
    // a handset set to Arabic-Indic numerals, and `calendar: 'gregory'` so a
    // handset on the Hijri calendar does not hand back a Hijri month. The
    // weekday is then computed from the date rather than read as a NAME, which
    // is the only part of this that could have had a language.
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: tz, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '');
    const y = get('year'); const mo = get('month'); const d = get('day');
    const hour = get('hour'); const minute = get('minute');
    if (![y, mo, d, hour, minute].every((n) => Number.isFinite(n))) return null;
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    // `Date.UTC` with a two-digit year maps 0-99 onto 1900-1999, which would
    // silently move the weekday. Nothing in this app books a session in year 24.
    if (y < 1000) return null;
    return { dow, hour: hour % 24, minute };
  } catch {
    return null;
  }
}

/**
 * The booked sessions in a window that plausibly belong to one series.
 *
 * ── The defect this exists to end ────────────────────────────────────────
 *
 * `app/(client)/standing.tsx` previewed a pause by taking EVERY booked session
 * of the member's inside the window — no filter on the series, and there could
 * not be one, because `TrainingSession` in src/lib/types.ts carries no series
 * id. The count went straight into `pausePreviewLine`, which states as fact how
 * many sessions will be cancelled and what the late fees come to. A member with
 * a second standing slot, or a one-off Friday booking, was shown a claim about
 * money over a set the pause was never going to touch, in the alert immediately
 * before they pressed confirm.
 *
 * ── Why this is a match and not an identity ──────────────────────────────
 *
 * With no series id on the row, the strongest thing available is the slot the
 * series describes: the same coach, the same weekday, the same wall-clock time
 * IN THE SERIES' OWN ZONE, and the same length. That removes the two cases in
 * the complaint outright — a second standing slot is a different weekday or a
 * different hour, and a one-off is almost never both. What it cannot rule out
 * is a one-off booked with the same coach at exactly the series' slot, which
 * the server's pause would cancel anyway.
 *
 * The zone matters and is not a nicety: `_materialise_session_series` computes
 * `(date + time) at time zone tz`, so a London Tuesday at 07:00 is a different
 * instant either side of a daylight-saving change and reading it in the phone's
 * zone would drop every occurrence after the clocks moved.
 *
 * A session whose zone could not be read is INCLUDED. The preview is about
 * somebody's money and the honest failure is to over-count, not to hide.
 */
export function seriesOccurrencesIn(
  sessions: readonly { clientId: string | null; trainerId: string; startsAt: string; durationMin: number; status: string }[],
  series: Pick<RecurringSeries, 'trainerId' | 'clientId' | 'dow' | 'hour' | 'minute' | 'durationMin' | 'tz'>,
  fromMs: number,
  untilMs: number,
): { startsAt: string }[] {
  const out: { startsAt: string }[] = [];
  for (const x of sessions) {
    if (x.status !== 'booked') continue;
    if (x.clientId !== series.clientId) continue;
    if (x.trainerId !== series.trainerId) continue;
    const at = Date.parse(x.startsAt);
    if (!Number.isFinite(at) || at <= fromMs || at >= untilMs) continue;
    if (x.durationMin !== series.durationMin) continue;
    const slot = zonedSlot(x.startsAt, series.tz);
    // Unreadable zone: kept. Over-counting a preview is recoverable; telling
    // somebody a session will not be cancelled when it will is not.
    if (slot && !(slot.dow === (((series.dow % 7) + 7) % 7) && slot.hour === series.hour && slot.minute === series.minute)) continue;
    out.push({ startsAt: x.startsAt });
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
  // Whether there is a session to talk about at all. The caller hands this an
  // empty string when the arrangement has nothing written out yet, and
  // `insideNoticeWindow` answers false for an unparseable instant BY DESIGN —
  // so the verdict came back 'in-time' and the sheet printed "Frees this one
  // only … This is more than 24 hours away, so no fee applies", plus "Affects
  // 1 booked session", about an hour that does not exist. The fee sentence is
  // the dangerous one: a specific claim about the member's money over a session
  // with no date. `seriesDetail` below has always handled the same missing
  // value correctly; this half did not.
  const hasNext = typeof o.startsAt === 'string' && o.startsAt.trim().length > 0
    && Number.isFinite(Date.parse(o.startsAt));
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

  const series: CancelOption = {
    scope: 'series',
    label: 'End the standing appointment',
    detail: seriesDetail(later, o.startsAt),
    charges: false,
    verdict: null,
    affects: later,
  };

  // No next occurrence, no occurrence option. Withheld rather than reworded:
  // every field on it — the label, the fee verdict, the count of one — is a
  // statement about a specific session, and there is none. The caller says so
  // in its own words instead. See `cancelOptions` callers for that sentence.
  if (!hasNext) return [series];

  return [
    {
      scope: 'occurrence',
      label: 'Cancel this session only',
      detail: occurrenceDetail(verdict, notice),
      charges,
      verdict,
      affects: 1,
    },
    series,
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
      return `Frees this one only — the rest of the standing appointment is untouched. This is inside ${w}, so a late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} is recorded. Repple doesn’t take this payment.${unstatedCurrency(v.currency)}`;
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

/**
 * Why eight weeks of Tuesdays do not empty a ten-session pack, and when they do
 * come off it.
 *
 * This used to end "your coach settles what's owed with you", which was true
 * and was the app admitting it had lost track: a client on a ten-pack with a
 * standing Tuesday consumed no credits at all, ever, so the balance on the
 * coach's Payments screen was wrong and the run-out alert never fired.
 *
 * Part 193 draws one credit AT DELIVERY — when the session is marked completed
 * — rather than when it is booked. The distinction is the whole sentence: the
 * materialiser creates occurrences eight weeks ahead, so drawing at booking
 * would empty a ten-pack in the first fortnight for sessions nobody has had
 * yet, and ending the series would then have to hand every one of them back.
 * Drawing at delivery needs no forecast and no unwind, because a session that
 * never happened was never marked.
 */
export const RECURRING_CREDIT_NOTE =
  'A standing appointment books the time, not the sessions. Nothing comes off a session pack when the dates '
  + 'are put in the diary — a credit is drawn as each session is marked done, one at a time, so weeks that '
  + 'have not happened yet are not paid for in advance.';

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
