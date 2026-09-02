// How long a session pack is good for, and what happens on the day it is not.
//
// ── The gap this fills ────────────────────────────────────────────────────
//
// `trainer_packages` has always said how many sessions a pack holds and what it
// costs, and never how long the buyer has to use them. So a ten-pack bought in
// 2024 was ten sessions a coach still owed somebody in 2026, at 2024's price,
// and the only way out of that was a conversation the coach had to start.
// Every gym in the world sells packs with a validity for that reason and this
// app could not express one. supabase/parts/612 is the other half of this file.
//
// ── THE RULE THAT MATTERS MOST HERE ───────────────────────────────────────
//
// A WINDOW BELONGS TO THE SALE, NOT TO THE PACKAGE.
//
// `expiresOn()` below is called ONCE, at checkout, and its answer is written on
// to `client_purchases.expires_on` and never recomputed. If the window were
// read off `trainer_packages` at render time instead, a coach adding a ninety-
// day validity to a package they had been selling for two years would — at the
// instant they pressed Save — void every unspent credit every one of those
// clients was holding. Nobody would have agreed to that and nobody would have
// been told. `VALIDITY_NOT_RETROACTIVE` is that sentence, and it belongs in
// front of the coach when they set one.
//
// It also settles the migration for free: every sale already in the table has
// no `expires_on`, and no window means no expiry, forever.
//
// ── AND THE ONE THAT DECIDES THE WORDS ────────────────────────────────────
//
// A PACK THAT EXPIRED WITH SESSIONS LEFT IS A CONVERSATION, NOT A ZERO.
//
// Somebody paid for six sessions they did not take. The honest handling is not
// to quietly stop counting them — it is to say how many, and on what day, to
// both people, so the coach can decide to extend it, sell them something, or
// say no. That is a decision that belongs to a person, and every sentence
// below is written so a person can have it rather than discover it.
//
// A MODULE AN EDGE FUNCTION IMPORTS MUST BE A LEAF. No relative imports —
// supabase/functions/stripe-webhook calls `expiresOn` at checkout so that the
// day the window closes is worked out by the same arithmetic the app reads it
// back with. See the header of src/lib/gymOrderPayment.ts for the whole
// argument; the short version is that Deno resolves './foo' literally and
// throws on the function's first request.

/** The longest window a coach may state, in days. Ten years, which is not a
 *  business rule so much as a typo catch: a coach meaning 90 and typing 900
 *  should be stopped somewhere, and the check constraint in part 612 stops it
 *  at the same number. */
export const VALIDITY_MAX_DAYS = 3650;

/** How close to the end counts as worth telling somebody about. Two weeks is
 *  enough to book the sessions that are left at a normal cadence; a week is
 *  not, and a month is far enough away to be ignored. */
export const EXPIRING_SOON_DAYS = 14;

/* ── the coach setting one ─────────────────────────────────────────────────── */

/** A validity a coach typed: a number of days, no window at all, or a refusal
 *  with the reason in it. */
export type TypedValidity =
  | { ok: true; days: number | null }
  | { ok: false; reason: string };

/**
 * What the coach typed into the validity field.
 *
 * An empty box is `days: null` and means NO EXPIRY — not zero, and not a
 * default. There is no default here and there must never be one: thirty days,
 * ninety days and a year are conventions in somebody's trade in somebody's
 * country, and defaulting to any of them would put a window on every pack every
 * coach on this platform already sells. That is part 188's refusal about a
 * payment term, held here for the same reason.
 *
 * Zero is refused rather than read as "no window", because a pack that expires
 * the day it is bought is a thing somebody could mean and could not possibly
 * want, and reading it as its opposite would be this file choosing.
 */
export function readValidityDays(text: string | null | undefined): TypedValidity {
  const t = String(text ?? '').trim();
  if (!t) return { ok: true, days: null };
  if (!/^\d{1,5}$/.test(t)) {
    return { ok: false, reason: 'Enter a whole number of days, or leave it empty for a pack that does not expire.' };
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, reason: 'A pack that expires on the day it is bought is not a pack. Leave it empty if it should not expire at all.' };
  }
  if (n > VALIDITY_MAX_DAYS) {
    return { ok: false, reason: `That is longer than ${VALIDITY_MAX_DAYS} days. Leave it empty for a pack that does not expire, rather than one that expires in ten years.` };
  }
  return { ok: true, days: n };
}

/** Said next to the field. The whole of why this is safe to add to a package
 *  that has already been selling for two years. */
export const VALIDITY_NOT_RETROACTIVE =
  'A validity applies to packs bought from now on. Anything a client is already holding keeps the terms it was sold under — adding a window here does not take credits off anybody, and changing it later does not reach a pack somebody has already paid for.';

/** Said next to the field when it is empty, so that "no expiry" reads as a
 *  choice rather than as a box somebody did not fill in. */
export const NO_VALIDITY_IS_FOREVER =
  'Left empty, the sessions on this pack never run out. That is what every pack sold in this app so far does.';

/** What a validity comes to on the client's side, in the words they buy under.
 *  Null when there is no window, because there is then nothing to say. */
export function validityLine(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  return days === 1
    ? 'The session on this pack has to be used within a day of buying it.'
    : `The sessions on this pack have to be used within ${days} days of buying it.`;
}

/* ── the day itself ────────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');

const isoParts = (isoDay: string | null | undefined): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDay ?? ''));
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
};

/**
 * The last day the credits on a pack bought on `boughtOn` can be used, or null
 * when the pack has no window.
 *
 * Through `Date.UTC` on the PARTS and back out through the UTC getters, never
 * through a local Date. This is exactly `plusDays` in src/lib/coachInvoice.ts
 * and it is written again here rather than imported for the leaf rule at the
 * top of this file — a local `new Date(y, m, d + 90)` is ninety days later by
 * the calendar, but the arithmetic runs through a DST boundary twice a year and
 * the round trip back to a `YYYY-MM-DD` can land a day out. On a deadline for
 * somebody's paid-for sessions that day is the difference between a credit and
 * a conversation.
 *
 * `boughtOn` may be a full ISO instant — the webhook holds one — and only its
 * date part is read. Anything that is not an ISO day returns null, so a caller
 * cannot get a plausible-looking wrong deadline out of a broken input; part
 * 612's constraint then refuses to expire a row that has no date on it.
 */
export function expiresOn(boughtOn: string | null | undefined, validityDays: number | null | undefined): string | null {
  const p = isoParts(boughtOn);
  if (!p) return null;
  if (validityDays == null || !Number.isFinite(validityDays) || validityDays <= 0) return null;
  const d = new Date(Date.UTC(p[0], p[1], p[2] + Math.trunc(validityDays)));
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Whole calendar days from `a` to `b`, both `YYYY-MM-DD`, or null. Through
 *  Date.UTC on the parts, for the reason above. */
function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = isoParts(a); const pb = isoParts(b);
  if (!pa || !pb) return null;
  const ta = Date.UTC(pa[0], pa[1], pa[2]);
  const tb = Date.UTC(pb[0], pb[1], pb[2]);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/* ── where a pack stands ───────────────────────────────────────────────────── */

/**
 * A pack's window, as far as a screen is concerned.
 *
 *   'none'    no window was ever set on this sale. Every pack sold before
 *             part 612 and every pack of a package with no validity.
 *   'open'    it has a window and there is comfortable time in it.
 *   'soon'    inside `EXPIRING_SOON_DAYS`, including the last day itself.
 *   'closed'  `run_pack_expiry` has closed it and taken what was left.
 *   'lapsed'  the last day has passed and nothing has closed it yet — the
 *             window between midnight and the nightly pass.
 *
 * 'lapsed' is its own answer rather than folded into 'closed' because in that
 * window the credits are STILL SPENDABLE: part 612 reduces `sessions_total`
 * when the pass runs, and until it does every draw site in the database will
 * happily take one. Telling a client their pack is gone while a booking would
 * still draw off it is the same class of mistake as telling them it is live
 * after the pass has run.
 */
export type PackWindow = 'none' | 'open' | 'soon' | 'lapsed' | 'closed';

/** One pack's expiry facts, as `client_purchases` holds them. */
export interface PackExpiry {
  /** `client_purchases.expires_on`, or null for a pack with no window. */
  expiresOn: string | null;
  /** `client_purchases.expired_at` — set once the nightly pass has closed it. */
  expiredAt?: string | null;
  /** `client_purchases.sessions_expired` — credits the window closed on
   *  unspent. Zero means none were lost, never unknown. */
  sessionsExpired?: number | null;
}

/**
 * Where this pack stands against its own window, as of the day the caller says
 * it is.
 *
 * `today` is passed in rather than read from a clock in here, for the reason
 * every date function in this codebase is written that way (see `invoiceAge` in
 * src/lib/coachInvoice.ts): `new Date()` here would be UTC-shaped and
 * untestable, and the caller already knows which day the DEVICE is on, which is
 * the only day that matters to the person holding it. `isoToday()` in
 * src/lib/dayPlan.ts is what produces it.
 */
export function packWindow(p: PackExpiry, today: string): PackWindow {
  if (p.expiredAt) return 'closed';
  const days = daysBetween(p.expiresOn, today);
  // No window, or a date this app cannot read. Both are 'none': a pack whose
  // expiry will not parse is one nothing may expire, and part 612's pass agrees
  // — it only ever touches a row whose `expires_on` is a real date.
  if (days == null) return 'none';
  if (days > 0) return 'lapsed';
  return -days <= EXPIRING_SOON_DAYS ? 'soon' : 'open';
}

/** How many days are left in the window, counting the last day as one. Null
 *  when there is no window, when the date will not read, or when it has already
 *  passed — "0 days left" and "it is over" are different readings. */
export function daysLeftOn(p: PackExpiry, today: string): number | null {
  if (p.expiredAt) return null;
  const days = daysBetween(p.expiresOn, today);
  if (days == null || days > 0) return null;
  return -days + 1;
}

/**
 * How a date reads in a sentence about somebody's pack.
 *
 * Deliberately NOT `toLocaleDateString`: `npm test` runs under six timezones
 * and this is asserted, and more importantly a pack's last day is a calendar
 * day rather than an instant — rendering it through a Date would move it across
 * a boundary for a client east of UTC. The format is the one part 202 and part
 * 471 already use in a notification body, so a coach reads one shape of date.
 */
export function expiryDayLabel(isoDay: string | null | undefined): string | null {
  const p = isoParts(isoDay);
  if (!p) return null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad2(p[2])} ${MONTHS[p[1]]} ${p[0]}`;
}

/**
 * The line under a pack about its window, or null when there is nothing to say.
 *
 * Null for a pack with no window — a sentence there would put "this does not
 * expire" under every pack in the product, which is noise on the ninety-nine
 * per cent — and null for a pack still comfortably inside one.
 *
 * `left` is what is still on the pack, so the two states that matter most can
 * be told apart: a window closing on a pack with nothing on it is not news, and
 * a window closing on a pack with five sessions on it is the whole point.
 */
export function expiryLine(p: PackExpiry, left: number | null, today: string): string | null {
  const state = packWindow(p, today);
  const day = expiryDayLabel(p.expiresOn);
  const lost = Number(p.sessionsExpired ?? 0);
  switch (state) {
    case 'none':
    case 'open':
      return null;
    case 'soon': {
      const n = daysLeftOn(p, today);
      if (!day || n == null) return null;
      if (left != null && left <= 0) return null;
      const when = n === 1 ? 'today is the last day' : `${n} days left`;
      return left == null
        ? `This pack runs out on ${day} — ${when}.`
        : `${left} session${left === 1 ? '' : 's'} on this pack, and it runs out on ${day} — ${when}.`;
    }
    case 'lapsed':
      // Still spendable until the nightly pass runs, and saying otherwise would
      // be a claim the database has not made yet.
      return day ? `This pack ran out on ${day}. Anything still on it is being closed off.` : null;
    case 'closed':
      if (lost > 0) {
        return day
          ? `${lost} session${lost === 1 ? '' : 's'} were still on this pack when it ran out on ${day}, and they can no longer be booked.`
          : `${lost} session${lost === 1 ? '' : 's'} were still on this pack when it ran out, and they can no longer be booked.`;
      }
      return day ? `This pack ran out on ${day}. Everything on it had been used.` : null;
  }
}

/**
 * What the COACH is told about a pack whose window closed with sessions on it,
 * or null when there is nothing to raise.
 *
 * The counterpart of `expiryLine` and a different sentence on purpose: the
 * client's line states what happened to their money, and this one is about a
 * decision the coach has to make. It carries no amount, because the number of
 * sessions is the fact and `minorMoney` in src/lib/coachMoney.ts is the only
 * thing in this codebase that may put a currency in front of a figure.
 */
export function strandedNote(who: string | null | undefined, p: PackExpiry, today: string): string | null {
  if (packWindow(p, today) !== 'closed') return null;
  const lost = Number(p.sessionsExpired ?? 0);
  if (!Number.isFinite(lost) || lost <= 0) return null;
  const name = String(who ?? '').trim() || 'This client';
  const day = expiryDayLabel(p.expiresOn);
  return `${name} paid for ${lost} session${lost === 1 ? '' : 's'} they did not take${day ? `, and the pack ran out on ${day}` : ''}.`
    + ' Extending it, selling them something else or leaving it are all yours to choose — but they will notice, and it is better coming from you.';
}

/** Said once wherever expired packs are listed. Nothing in this app gives a
 *  credit back on its own, and a coach reading a list of stranded sessions
 *  should know that before they assume somebody is chasing it. */
export const EXPIRY_IS_NOT_A_REFUND =
  'Sessions that ran out of time are not refunded and nothing gives them back automatically. What was charged was charged, and what to do about it is a conversation between you and them.';
