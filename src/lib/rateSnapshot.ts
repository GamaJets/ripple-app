// What one delivered session is filed as being worth — the ONE place the three
// screens that write `sessions.rate_cents` agree on the two numbers.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// Three screens snapshot the rate when a session is marked delivered:
// app/(trainer)/sessions.tsx, app/(trainer)/calendar.tsx and
// app/(trainer)/log-session.tsx. All three converted the fee with
//
//     minorFromWhole(fee, tenant?.currency)
//
// and `tenant` is the gym on `profiles.tenant_id`. A self-employed coach with
// no gym has no tenant, so the currency was null, so `minorFromWhole` returned
// null — correctly, because there was genuinely no unit — and every session
// they ever delivered was filed with `rate_cents` unset. Part 940 gave that
// coach `trainers.currency` and src/lib/currencySource.ts gave it a precedence
// rule, and none of the three writers had been taught to ask.
//
// They are converted TOGETHER, in this module, because a half-converted
// snapshot is worse than a consistently missing one: a coach who finishes one
// session from the queue, one from the schedule and one from the log screen
// would have three sessions of the same hour's work filed three different ways,
// and nothing on any screen would say which of the three was right.
//
// ── This does not touch a snapshot that already exists ────────────────────
//
// `rate_cents` on a delivered session is a HISTORICAL FACT: what that session
// was worth AT THE TIME it was marked. Nothing here backfills, rewrites or
// re-derives one. A session marked before part 940 with no rate keeps no rate,
// and a session marked in a currency the coach has since changed keeps the
// figure it was filed with. This changes only what is written from now on —
// which is also why the conversion is done at the MOMENT of marking and carried
// into the offline queue rather than recomputed when the queue flushes.
//
// ── Null is still the honest answer ───────────────────────────────────────
//
// A coach who has set nothing anywhere gets null, the callers turn that into
// `undefined`, and the queue's sender then leaves the column untouched.
// `payrollByTrainer` reads a missing snapshot as UNKNOWN and falls back to the
// rate the gym states today, which is a figure somebody chose. A zero is not:
// it reads as "this session was free" and it settles payroll short. There is no
// fallback currency in this product and there is none here.
//
// Pure: no react, no supabase. The impure half is `fetchMyCurrency()` in
// src/lib/myCurrency.ts, whose answer the callers hand in as `mine`.
import { minorFromWhole } from './coachMoney';
import type { MyCurrency } from './currencySource';

/** Everything the three writers know at the moment of marking. */
export interface RateSnapshotSource {
  /** `tenants.session_fee`, in whole units, as the tenant provider holds it. */
  gymFee: number | null | undefined;
  /** `trainers.session_fee` — the coach's own rate, in whole units. */
  ownFee: number | null | undefined;
  /**
   * `tenants.currency` as the tenant provider ALREADY HOLDS IT, in memory.
   *
   * Passed separately from `mine` rather than left to it on purpose. These
   * three screens are used standing in a basement — that is the whole reason
   * they write through the floor queue — and a gym coach whose tenant is
   * already loaded must not lose their rate snapshot because a fresh network
   * read of the same fact could not be made. It is also the gym's own column,
   * so preferring it cannot break the precedence rule: see below.
   */
  gymCurrency: string | null | undefined;
  /**
   * `fetchMyCurrency()`'s answer, or null while it is still in flight.
   *
   * Already resolved by `resolveMyCurrency` — gym first, the coach's own column
   * if and only if there is provably no gym, and a null code for every one of
   * the six gaps. `currency` is therefore never a code nobody chose, which is
   * why this module reads it and nothing else off the answer.
   */
  mine: MyCurrency | null | undefined;
}

const code = (v: string | null | undefined): string | null => {
  const c = (v || '').trim().toUpperCase();
  return c ? c : null;
};

/**
 * The fee to snapshot: the gym's where there is one, otherwise the coach's own.
 *
 * `??` and not `||`, because a gym that states a session fee of nothing has
 * STATED it — sessions inside a membership are a real arrangement — and falling
 * through to the coach's personal rate on the strength of a zero would file
 * those sessions at a figure the gym never agreed to.
 */
export function snapshotFee(gymFee: number | null | undefined, ownFee: number | null | undefined): number | null {
  return gymFee ?? ownFee ?? null;
}

/**
 * The currency to snapshot in, or null when nothing has named one.
 *
 * The gym's in-memory code first, and this does NOT weaken the precedence rule
 * in src/lib/currencySource.ts — it is the same rule reached one step earlier.
 * `gymCurrency` is `tenants.currency` for the gym on `profiles.tenant_id`,
 * which is exactly the column `resolveMyCurrency` calls the authority, so
 * taking it can only ever agree with `mine`. What it cannot do is be
 * overridden: the coach's own column is reached only when the gym half is
 * empty, and `mine.currency` is itself null at every gap — including
 * 'gym-unset', where a gym exists and its owner has chosen nothing. A coach
 * waiting on their owner stays waiting, and their own column stays dormant.
 */
export function snapshotCurrency(gymCurrency: string | null | undefined, mine: MyCurrency | null | undefined): string | null {
  return code(gymCurrency) ?? code(mine?.currency) ?? null;
}

/**
 * The figure to write into `sessions.rate_cents`, or null to write nothing.
 *
 * Minor units, converted by however many places the currency actually has —
 * never a factor of a hundred. Sixteen currencies have no minor unit at all, so
 * a ¥6,300 session snapshotted with `* 100` was filed as 630,000, and five have
 * a thousand, so a KWD 40 one was filed as a tenth of itself. This is the
 * column payroll is settled from.
 *
 * The three writers call THIS, with the same argument shape, so a session is
 * worth the same amount whichever of them recorded it.
 */
export function rateCentsToSnapshot(s: RateSnapshotSource): number | null {
  return minorFromWhole(snapshotFee(s.gymFee, s.ownFee), snapshotCurrency(s.gymCurrency, s.mine));
}
