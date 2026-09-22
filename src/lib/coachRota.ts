// The rota, read back to the person who has to work it.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// `gym_shifts` (supabase/parts/43) has admitted the gym's trainers since the
// day it was written, and the comment above the policy says exactly why:
//
//     -- Trainers read it. A rota nobody rostered on it can see is a rota that
//     -- gets re-typed into WhatsApp, which is how it stops being true.
//     create policy gym_shifts_staff_r on gym_shifts
//       for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));
//
// The permission was written for this and nothing was ever built on it. Both
// readers of the table are the owner's — app/(owner)/rota.tsx and
// studio-web/app/staff — so the rota is written by the gym and read by the gym,
// and the coach whose Saturday is on it finds out by message.
//
// ── Read only, and that is the schema's decision rather than this file's ───
//
// `gym_shifts_owner` is the only policy granting anything but SELECT. A coach
// cannot add, move, price or pull a shift, and src/lib/gymRota.ts already says
// what happens to an attempt: the UPDATE matches zero rows and `assertWrote`
// turns that silence into a refusal. So there are no controls here, and the
// screen says where a change is made instead of offering one that cannot work.
//
// ── The four silences ─────────────────────────────────────────────────────
//
// The same four src/lib/coachKit.ts lists, and one of them is sharper here:
// an empty fortnight drawn as a blank list tells a coach they are not on this
// week. They then do not turn up. "Nothing is rostered for you" and "we could
// not read the rota" must therefore be different sentences, and "you have no
// gym" must be a third — seven coaches are live on this product and every one
// of them is alone in their own tenant, so the third is the ordinary case.
//
// ── Money: one pot per currency, never a sum across two ───────────────────
//
// `gym_shifts.rate_cents` is what the shift is worth FOR ITS WHOLE SPAN, with
// its own `currency` beside it and `gym_shifts_priced_or_not` guaranteeing the
// pair. Part 196's header spells out why the rate is snapshotted on the row:
// February's rota must not be re-priced when March's rates change. A coach's
// fortnight can therefore legitimately span two currencies — a gym that
// switched, a coach who works two sites of one tenant — so the pots are kept
// apart and nothing here adds them. `PRICED_IS_NOT_PAID` is the other half of
// the honesty: this app has no idea whether any of it has been handed over.
//
// Pure: no react, no supabase, no clock beyond the `now` handed in.
import { rotaDay, rotaTimeLabel } from './rotaClock';
import { shiftHours, isLive, type Shift, type ShiftRole } from './gymRota';
import { noGymNote } from './gymLink';
// One place decides what 'none' and 'unknown' mean — see src/lib/coachKit.ts
// and src/lib/coachClose.ts, which import the same type for the same reason.
import type { GymLink } from './coachPayTerms';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/* ── the sentences ────────────────────────────────────────────────────────── */

/** A read that did not land. Never rendered as a fortnight off. */
export const ROTA_UNREAD_NOTE =
  'Your gym’s rota could not be read, so this is not a list of the shifts you have. ' +
  'It is not a statement that you have none. Check with the gym before you plan around it.';

/**
 * A whole read that found nothing.
 *
 * Says which window it looked at, because "nothing rostered" without a span is
 * a claim about all of time and this is a claim about a fortnight.
 */
export function rotaEmptyNote(days: number): string {
  return `Your gym has you on no shifts in the next ${days} days. That is the rota as it stands now. ` +
    'It is written on the gym’s side and can change without this screen being opened.';
}

/** Why there is nothing to press. See the header. */
export const ROTA_READ_ONLY_NOTE =
  'The rota is written by your gym. This is their copy of it, not a second one. If a shift here is wrong, it is wrong on theirs too.';

/**
 * What a figure against a shift is and is not.
 *
 * The same separation `SETTLED_IS_NOT_RECEIVED` makes on the coach's pay
 * screen. A rate filed against a Saturday is what the gym wrote down that
 * Saturday was worth; whether it reached anybody is a fact this product has
 * never seen.
 */
export const PRICED_IS_NOT_PAID =
  'These are the figures your gym filed against the shifts. Whether any of them has been paid is not something this app can see.';

/** A pulled shift is kept rather than deleted, and this says why it is shown. */
export const PULLED_IS_NOT_GONE =
  'A shift your gym pulled stays on the list, struck through. “Somebody was rostered and it was dropped” and “nobody was ever rostered” leave the same hole in a week and are not the same thing to plan around.';

/**
 * What a coach is on for.
 *
 * A copy of the private `ROLE_LABEL` in app/(owner)/rota.tsx, which is not
 * exported and sits in a file this lane may not touch. Stated here rather than
 * abbreviated, because the owner's grid has a column header giving the words
 * context and a coach's list has nothing but the row.
 */
export const SHIFT_ROLE_LABEL: Record<ShiftRole, string> = {
  floor: 'On the floor',
  classes: 'Teaching classes',
  pt: 'One-to-ones',
  desk: 'On the desk',
  admin: 'Admin',
};

/* ── the shapes ───────────────────────────────────────────────────────────── */

/** One shift of the coach's own, with its labels already on the gym's clock. */
export interface MyShift {
  id: string;
  role: ShiftRole;
  /** True when the gym pulled it. Kept and shown — see `PULLED_IS_NOT_GONE`. */
  pulled: boolean;
  /** 'HH:MM' at the GYM, or null when the zone or the instant could not give
   *  one. Null is rendered as a sentence, never as an invented time. */
  fromLabel: string | null;
  toLabel: string | null;
  /** Hours, or null when the row cannot be read as a span — never 0. */
  hours: number | null;
  note: string | null;
  /** Minor units for the WHOLE span. Null is "nobody priced it", not "free". */
  rateCents: number | null;
  /** Null exactly when `rateCents` is, which the database enforces. */
  currency: string | null;
}

/** A day of the window with the coach's shifts on it. Days with none are not
 *  emitted — a fortnight of empty rows buries the three that are not. */
export interface RotaDayLine {
  /** 'YYYY-MM-DD' on the gym's calendar. Compared and grouped as a string. */
  day: string;
  shifts: MyShift[];
}

/** One money's worth of priced shifts. Never combined with another. */
export interface PayPot {
  currency: string;
  cents: number;
  shifts: number;
}

export type CoachRotaView =
  | { kind: 'unread'; note: string }
  | { kind: 'no_gym'; note: string }
  /** A gym, a whole read, and nothing rostered in the window. */
  | { kind: 'none'; note: string }
  | {
      kind: 'rota';
      days: RotaDayLine[];
      /** Shifts not pulled. The number a coach plans around. */
      live: number;
      /** Shifts the gym pulled. Counted separately and never netted off. */
      pulled: number;
      /**
       * Hours across the live shifts, or null when ANY of them could not be
       * read as a span.
       *
       * All-or-nothing on purpose: a total that silently skips the row it could
       * not read looks exactly like a whole one and is smaller, which is the
       * direction a figure about somebody's working fortnight must never be
       * wrong in. `summariseRota` on the owner's side skips them, because that
       * screen also prints the shift count beside it and a gap is visible there.
       */
      hours: number | null;
      /** One pot per currency, ordered by code. Never summed together. */
      pots: PayPot[];
      /** Live shifts with no rate on them. Not free — nobody priced them. */
      unpriced: number;
    };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/** A currency code as it will be compared. Trimmed and upper-cased, so 'gbp'
 *  and ' GBP ' cannot become two pots — the same normalising `fetchShifts`
 *  performs on the way in, restated because a hand-built row may skip it. */
function code(c: string | null | undefined): string | null {
  const s = (c ?? '').trim().toUpperCase();
  return s || null;
}

/**
 * The coach's own shifts in the window, grouped by the gym's calendar day.
 *
 * Bucketed by `rotaDay(at, zone)` and not by the phone's date: a 22:00 shift at
 * a gym four hours ahead of a reader falls on the gym's evening, and a coach
 * reading "Tuesday" about a shift the gym has on Wednesday turns up on the
 * wrong day. That is the whole reason src/lib/rotaClock.ts exists.
 *
 * A row whose start cannot be placed on any day is DROPPED, and that is the one
 * exclusion here. It has no day to be listed under, and inventing one would put
 * a shift in front of a coach on a date nobody rostered it for.
 *
 * Days ascending, and within a day by start then id — a total order, because
 * two shifts opening at the same hour is ordinary and a list that reshuffles
 * between renders is one a thumb lands on the wrong row of.
 */
export function myRotaDays(shifts: readonly Shift[], zone: string | null | undefined): RotaDayLine[] {
  const byDay = new Map<string, { at: number; shift: MyShift }[]>();
  for (const s of shifts) {
    const day = rotaDay(s.startsAt, zone);
    if (!day) continue;
    const at = Date.parse(s.startsAt);
    const line: MyShift = {
      id: s.id,
      role: s.role,
      pulled: !isLive(s),
      fromLabel: rotaTimeLabel(s.startsAt, zone),
      toLabel: rotaTimeLabel(s.endsAt, zone),
      hours: shiftHours(s),
      note: (s.note ?? '').trim() || null,
      rateCents: typeof s.rateCents === 'number' ? s.rateCents : null,
      currency: code(s.currency),
    };
    const bucket = byDay.get(day);
    if (bucket) bucket.push({ at, shift: line });
    else byDay.set(day, [{ at, shift: line }]);
  }
  return [...byDay.entries()]
    // Day keys are 'YYYY-MM-DD' and sort chronologically as strings. Not parsed:
    // a bare day compared as a date is how a UTC midnight gets into a sort.
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, rows]) => ({
      day,
      shifts: rows
        .sort((a, b) => {
          const av = Number.isFinite(a.at) ? a.at : Number.POSITIVE_INFINITY;
          const bv = Number.isFinite(b.at) ? b.at : Number.POSITIVE_INFINITY;
          return (av - bv) || a.shift.id.localeCompare(b.shift.id);
        })
        .map((r) => r.shift),
    }));
}

/**
 * What the live shifts come to, one pot per money.
 *
 * Pulled shifts contribute nothing: the gym dropped them and is not paying for
 * them, and netting them off a total would be inventing a deduction nobody
 * filed. Unpriced shifts are COUNTED rather than treated as zero — part 196's
 * constraint exists precisely so that an amount with no currency cannot be
 * written down, and a shift nobody priced is not a shift worth nothing.
 */
export function shiftPay(shifts: readonly MyShift[]): { pots: PayPot[]; unpriced: number } {
  const pots = new Map<string, PayPot>();
  let unpriced = 0;
  for (const s of shifts) {
    if (s.pulled) continue;
    if (s.rateCents == null || !s.currency) { unpriced += 1; continue; }
    const pot = pots.get(s.currency);
    if (pot) { pot.cents += s.rateCents; pot.shifts += 1; }
    else pots.set(s.currency, { currency: s.currency, cents: s.rateCents, shifts: 1 });
  }
  return {
    pots: [...pots.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    unpriced,
  };
}

/**
 * Hours across the live shifts, or null when any one of them could not be read.
 *
 * See the field comment on `hours` for why this is all-or-nothing.
 */
export function liveHours(shifts: readonly MyShift[]): number | null {
  let total = 0;
  let any = false;
  for (const s of shifts) {
    if (s.pulled) continue;
    if (s.hours == null) return null;
    total += s.hours;
    any = true;
  }
  return any ? total : null;
}

/**
 * The whole section, decided once.
 *
 * `link` and `status` both, and neither inferred from the rows: an empty array
 * is the same array under all four silences, so the rows can never be what
 * decides which sentence is printed.
 */
export function coachRotaView(
  link: GymLink,
  status: LoadStatus,
  shifts: readonly Shift[] | null,
  zone: string | null | undefined,
  windowDays: number,
): CoachRotaView {
  if (link === 'unknown') return { kind: 'unread', note: ROTA_UNREAD_NOTE };
  if (link === 'none') return { kind: 'no_gym', note: noGymNote('shifts rostered for you') };
  if (!isWhole(status) || !shifts) return { kind: 'unread', note: ROTA_UNREAD_NOTE };

  const days = myRotaDays(shifts, zone);
  const flat = days.flatMap((d) => d.shifts);
  if (flat.length === 0) return { kind: 'none', note: rotaEmptyNote(windowDays) };

  const { pots, unpriced } = shiftPay(flat);
  return {
    kind: 'rota',
    days,
    live: flat.filter((s) => !s.pulled).length,
    pulled: flat.filter((s) => s.pulled).length,
    hours: liveHours(flat),
    pots,
    unpriced,
  };
}

/**
 * The figure beside the heading, or null.
 *
 * Null under every view that is not a whole read, for the reason `kitHeadNote`
 * gives: a "0" beside a heading about somebody's shifts is read as "you are not
 * on this week", and that is the one claim an unread rota must not make.
 */
export function rotaHeadNote(view: CoachRotaView): string | null {
  if (view.kind !== 'rota') return null;
  return view.live === 1 ? '1 shift' : `${view.live} shifts`;
}
