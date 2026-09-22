// The one sentence a coach needs before they read the list: has anything lapsed?
//
// ── The defect this closes ────────────────────────────────────────────────
//
// app/(trainer)/credentials.tsx draws every credential with its own expiry
// line — `expiryLine` in src/lib/coachCredentials.ts says "Expired 12 days ago"
// against the row it belongs to, and `sortCredentials` pushes the lapsed ones
// to the bottom. Both are right, and between them they mean the fact that
// matters most is the fact furthest down the screen. A coach with six
// qualifications and a public liability policy has to read seven rows, scroll
// past the four that are fine, and notice a phrase on the last one, to find out
// that their cover ran out in March. The screen already KNEW; nothing said it
// where the coach was looking.
//
// The insurance half was half-said: the screen carries a lapsed-cover flag, but
// it is below the list, it fires only for insurance, and it says nothing about
// a certification that expired or one falling due next month.
//
// ── No new date arithmetic lives here ─────────────────────────────────────
//
// `credentialState` and `daysUntil` in src/lib/coachCredentials.ts already
// decide what 'expired' and 'expiring' mean, they take the day as an argument
// rather than reading a clock, and npm test runs them under six timezones. A
// second opinion about what "expired" means, written here, is how two screens
// come to disagree about whether somebody may be on a gym floor. This module
// counts what that one decides, and holds no `Date` at all.
//
// ── Nothing is counted over a read that is not the whole set ──────────────
//
// The rule from src/ui/loadStatus.ts, and it bites harder here than on a
// dashboard figure. "Nothing has lapsed" computed over part of a list is the
// exact sentence that lets a coach walk onto a floor uninsured. So `whole` is
// an argument rather than an assumption, and under a read that is not whole the
// only thing this will say is a FLOOR — "at least one has expired, and this is
// not all of them" — which can only ever under-report a problem. It will never
// produce a reassurance from a partial read, because a reassurance is the one
// claim a prefix of the set cannot support.
import { credentialState, daysUntil, EXPIRING_SOON_DAYS, type Credential } from './coachCredentials';

/**
 * What the top of the credentials screen may say.
 *
 * 'unknown' and 'nothing-listed' both render as NOTHING — the screen already
 * carries a full notice for each of those two cases, and a second sentence
 * repeating it is noise above the one that matters.
 */
export type ExpirySummary =
  /** The read did not complete, or has not yet. Nothing may be said. */
  | { kind: 'unknown' }
  /** The read completed and this coach has listed nothing at all. */
  | { kind: 'nothing-listed' }
  /**
   * A read that is NOT the whole set, holding at least one lapse or one due
   * soon. Both numbers are floors and the wording says so. Produced only when
   * there is something to warn about: a truncated read may raise an alarm, and
   * may never settle one.
   */
  | { kind: 'floor'; expired: number; expiring: number }
  /** Everything with a date on it is in date, and nothing falls due soon. */
  | { kind: 'all-in-date'; undated: number }
  /** Something has lapsed, or is about to. */
  | {
      kind: 'attention';
      expired: number;
      expiring: number;
      /** True when one of the expired rows is a policy rather than a course.
       *  It is the one a gym refuses entry over, so it is said separately. */
      insuranceExpired: boolean;
      /** Whole days to the nearest expiry still ahead, or null when every
       *  dated credential has already passed. */
      soonest: number | null;
    };

/**
 * Fold a credential list into the one thing to say about its expiries.
 *
 * @param list the credentials, or null when the read produced none — null is
 *   UNKNOWN and never "this coach has listed nothing", which is the distinction
 *   `insuranceClaim` in src/lib/coachCredentials.ts exists to hold.
 * @param today `YYYY-MM-DD` in the reader's own day, passed in so this stays
 *   pure and so a screen left open overnight is judged against tonight rather
 *   than against the day it mounted (src/ui/today.ts).
 * @param whole `isWhole(status)` from src/ui/loadStatus.ts. False means the
 *   rows are real but are a prefix of the set.
 */
export function expirySummary(
  list: readonly Credential[] | null,
  today: string,
  whole: boolean,
): ExpirySummary {
  if (list === null) return { kind: 'unknown' };

  let expired = 0;
  let expiring = 0;
  let undated = 0;
  let insuranceExpired = false;
  let soonest: number | null = null;

  for (const c of list) {
    const state = credentialState(c, today);
    if (state === 'no-expiry') { undated += 1; continue; }
    if (state === 'expired') {
      expired += 1;
      if (c.kind === 'insurance') insuranceExpired = true;
      continue;
    }
    if (state === 'expiring') expiring += 1;
    // 'current' counts towards `soonest` as well: a coach whose nearest renewal
    // is 90 days out is told nothing by this branch, but the value is what lets
    // the 'attention' wording name the next one to fall when something ELSE has
    // already lapsed.
    const d = daysUntil(c.expiresOn, today);
    if (d !== null && (soonest === null || d < soonest)) soonest = d;
  }

  // A prefix of the set may raise an alarm and may never settle one. There is
  // no honest "nothing has lapsed" over rows we know we did not all receive.
  if (!whole) {
    return expired + expiring > 0 ? { kind: 'floor', expired, expiring } : { kind: 'unknown' };
  }

  if (list.length === 0) return { kind: 'nothing-listed' };
  if (expired + expiring === 0) return { kind: 'all-in-date', undated };
  return { kind: 'attention', expired, expiring, insuranceExpired, soonest };
}

/** "1 qualification", "3 qualifications" — the count and the noun, once. */
function items(n: number): string {
  return `${n} ${n === 1 ? 'qualification or policy' : 'qualifications or policies'}`;
}

/**
 * The sentence itself, or null when nothing is to be said.
 *
 * Null rather than an empty string, so the screen's `? :` renders no element at
 * all — an empty Text still takes a line's margin and still lands in the
 * accessibility tree as a blank.
 */
export function expirySummaryLine(s: ExpirySummary): string | null {
  switch (s.kind) {
    // Both of these already have their own full notice on the screen. Saying it
    // twice pushes the list further down and adds nothing.
    case 'unknown':
    case 'nothing-listed':
      return null;

    case 'floor': {
      // Never a total. "At least" is the whole claim a prefix can support, and
      // the second sentence says why the number may be short rather than
      // leaving the coach to read it as a count.
      const bits: string[] = [];
      if (s.expired > 0) bits.push(`at least ${items(s.expired)} of yours ${s.expired === 1 ? 'has' : 'have'} expired`);
      if (s.expiring > 0) bits.push(`at least ${s.expiring} ${s.expiring === 1 ? 'is' : 'are'} due within ${EXPIRING_SOON_DAYS} days`);
      return `${bits.join(', and ')}. This is not all of your credentials, so there may be more. Open the list to see.`;
    }

    case 'all-in-date':
      return s.undated > 0
        ? `Nothing has lapsed, and nothing falls due in the next ${EXPIRING_SOON_DAYS} days. ${items(s.undated)} of yours ${s.undated === 1 ? 'carries' : 'carry'} no expiry date at all.`
        : `Nothing has lapsed, and nothing falls due in the next ${EXPIRING_SOON_DAYS} days.`;

    case 'attention': {
      const bits: string[] = [];
      if (s.expired > 0) bits.push(`${items(s.expired)} of yours ${s.expired === 1 ? 'has' : 'have'} expired`);
      if (s.expiring > 0) {
        bits.push(s.expired > 0
          ? `${s.expiring} more ${s.expiring === 1 ? 'falls' : 'fall'} due within ${EXPIRING_SOON_DAYS} days`
          : `${items(s.expiring)} of yours ${s.expiring === 1 ? 'falls' : 'fall'} due within ${EXPIRING_SOON_DAYS} days`);
      }
      let line = `${bits.join(', and ')}.`;
      // Said separately, because it is the one a gym turns somebody away over
      // and the one a client asks about before they book. It is also what the
      // coach's public profile is currently telling people — see the lapsed
      // branch of `insuranceClaim`.
      if (s.insuranceExpired) line += ' That includes the insurance cover on your profile, which is what clients are being shown.';
      else if (s.expired === 0 && s.soonest !== null) {
        line += s.soonest === 0 ? ' The nearest runs out today.'
          : ` The nearest runs out in ${s.soonest} day${s.soonest === 1 ? '' : 's'}.`;
      }
      return line;
    }
  }
}

/**
 * Whether the sentence needs a mark beside it.
 *
 * A `<Flag>` rather than warn-coloured ink: `t.warn` as TEXT is 3.87–4.08:1 on
 * the three light palettes, which is below AA and is the offence
 * scripts/check-contrast.mjs exists for. The dot carries the urgency and the
 * words stay readable.
 */
export function expirySummaryNeedsMark(s: ExpirySummary): boolean {
  return s.kind === 'attention' || s.kind === 'floor';
}
