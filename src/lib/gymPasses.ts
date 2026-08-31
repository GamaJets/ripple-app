// Drop-ins, guest passes and class packs — the money a gym takes from people
// who are not members.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// Money is held in minor units as integers, as everywhere else in the record.
//
// The rule this module exists to keep: a pass whose price nobody recorded is
// not a free pass. `passRevenueCents` returns null in that case rather than
// counting it as zero, because a gym reading "pass revenue: 0" when it took
// cash all week will make a worse decision than one reading a dash.

import { assertWhole, capLimit } from './rowCap';

type Queryable = { from: (table: string) => any };

export type PassKind = 'drop_in' | 'guest' | 'pack';

export interface PassType {
  id: string;
  name: string;
  kind: PassKind;
  priceCents: number;
  currency: string;
  uses: number;
  /** Days from issue until expiry. Null means it does not expire. */
  validDays: number | null;
  active: boolean;
}

export interface GymPass {
  id: string;
  passTypeId: string | null;
  passTypeName: string | null;
  kind: PassKind | null;
  holderId: string | null;
  holderName: string | null;
  hostMemberId: string | null;
  issuedOn: string;
  /** ISO date, or null when the pass does not expire. */
  expiresOn: string | null;
  usesTotal: number;
  usesSpent: number;
  /** Null means no price was recorded — not that it was free. */
  paidCents: number | null;
  /** ISO 4217 as the row states it. Null means the row does not say — which is
   *  a dash beside the amount, never a currency chosen on its behalf. */
  currency: string | null;
  note: string | null;
}

export interface Redemption {
  id: string;
  passId: string;
  classId: string | null;
  redeemedAt: string;
  redeemedBy: string | null;
}

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/** Visits left on a pass. Never negative, even if the counter is out of step. */
export function remainingUses(p: Pick<GymPass, 'usesTotal' | 'usesSpent'>): number {
  return Math.max(0, p.usesTotal - p.usesSpent);
}

/**
 * Whether the pass is past its expiry on `today`.
 *
 * A pass expiring today is still good today — a gym that turns someone away on
 * the last day of their pack has a complaint, not a policy. Both arguments are
 * plain ISO dates (YYYY-MM-DD) so this never depends on the device's timezone.
 */
export function isExpired(p: Pick<GymPass, 'expiresOn'>, today: string): boolean {
  if (!p.expiresOn) return false; // no expiry set is a decision, not a gap
  return p.expiresOn < today;
}

/** A pass can be taken at the desk when it has visits left and has not expired. */
export function isRedeemable(
  p: Pick<GymPass, 'usesTotal' | 'usesSpent' | 'expiresOn'>,
  today: string,
): boolean {
  return remainingUses(p) > 0 && !isExpired(p, today);
}

/**
 * The expiry date for a pass issued on `issuedOn` under a type valid for
 * `validDays`. Null validDays yields null — no expiry.
 *
 * Day-count arithmetic is done in UTC deliberately: constructing the date in
 * local time makes a pass issued late in the evening expire a day early for
 * anyone east of UTC.
 */
export function expiryFor(issuedOn: string, validDays: number | null | undefined): string | null {
  if (validDays == null) return null;
  const d = new Date(`${issuedOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + validDays);
  return d.toISOString().slice(0, 10);
}

/**
 * What the gym actually took for these passes.
 *
 * Returns null when not one pass carries a recorded price, so the caller shows
 * a dash. Passes with no price are skipped rather than treated as zero, and
 * `priced` reports how many were counted so the screen can say "from 12 of 19".
 */
export function passRevenueCents(
  passes: Pick<GymPass, 'paidCents'>[],
): { cents: number | null; priced: number; total: number } {
  let cents = 0;
  let priced = 0;
  for (const p of passes) {
    if (p.paidCents == null) continue;
    cents += p.paidCents;
    priced += 1;
  }
  return { cents: priced === 0 ? null : cents, priced, total: passes.length };
}

export interface PassSummary {
  issued: number;
  live: number;
  expired: number;
  usedUp: number;
  visitsRemaining: number;
  revenueCents: number | null;
  /** How many of the issued passes carried a recorded price. */
  priced: number;
}

/** The desk-level picture of every pass on the books. */
export function summarisePasses(passes: GymPass[], today: string): PassSummary {
  let live = 0;
  let expired = 0;
  let usedUp = 0;
  let visitsRemaining = 0;

  for (const p of passes) {
    const left = remainingUses(p);
    visitsRemaining += left;
    // Order matters: a pass that is both spent and expired is counted once, as
    // used up, because that is the one the member will argue about.
    if (left === 0) usedUp += 1;
    else if (isExpired(p, today)) expired += 1;
    else live += 1;
  }

  const { cents, priced } = passRevenueCents(passes);
  return { issued: passes.length, live, expired, usedUp, visitsRemaining, revenueCents: cents, priced };
}

/**
 * Guest passes brought by members, keyed by host.
 *
 * A gym wanting to reward the members who bring people needs to know who they
 * are; a gym wanting to know whether guest passes convert needs the same list.
 */
export function guestsByHost(passes: GymPass[]): { hostMemberId: string; guests: number }[] {
  const byHost = new Map<string, number>();
  for (const p of passes) {
    if (p.kind !== 'guest' || !p.hostMemberId) continue;
    byHost.set(p.hostMemberId, (byHost.get(p.hostMemberId) ?? 0) + 1);
  }
  return [...byHost.entries()]
    .map(([hostMemberId, guests]) => ({ hostMemberId, guests }))
    .sort((a, b) => b.guests - a.guests || a.hostMemberId.localeCompare(b.hostMemberId));
}

/** How the pass should read on a desk screen. */
export function passStatus(p: GymPass, today: string): 'live' | 'expired' | 'used up' {
  if (remainingUses(p) === 0) return 'used up';
  return isExpired(p, today) ? 'expired' : 'live';
}

/* ── pass types ────────────────────────────────────────────────────────────── */

/**
 * The gym's pass price book.
 *
 * Capped through src/lib/rowCap.ts. A price book with a thousand entries in it
 * is not a real gym, so this read will not truncate in practice — and "in
 * practice" is what every silent defect in this repo was made of. The cost if
 * it ever did is not cosmetic: the order is active-first then cheapest-first,
 * so the rows that fell off the end would be the DEAREST live types, /door
 * would offer the desk a price list missing exactly the passes worth most, and
 * a walk-in would be sold the wrong thing. It refuses rather than sell from
 * half a price list.
 */
export async function fetchPassTypes(sb: Queryable, tenantId: string): Promise<PassType[]> {
  const { data, error } = await sb
    .from('gym_pass_types')
    .select('id, name, kind, price_cents, currency, uses, valid_days, active')
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false })
    .order('price_cents', { ascending: true })
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data, "this gym's pass price book").map(rowToPassType);
}

function rowToPassType(r: any): PassType {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    priceCents: r.price_cents,
    currency: r.currency,
    uses: r.uses,
    validDays: r.valid_days ?? null,
    active: !!r.active,
  };
}

export interface NewPassType {
  name: string;
  kind: PassKind;
  priceCents: number;
  currency: string;
  uses?: number;
  validDays?: number | null;
}

/**
 * `currency` is REQUIRED on `NewPassType`, and was not.
 *
 * This wrote `t.currency ?? 'AED'` into `gym_pass_types.currency`, a column
 * declared `not null default 'AED'` — so an omitted currency did not fail, it
 * priced a gym's day passes in dirhams and every screen that read the pass
 * afterwards read that as the gym's own answer. Same shape, same silence and
 * same consequence as `createPlan` and `recordPayment` in src/lib/gymRecord.ts;
 * see the notes there. A price somebody is charged has no honest default.
 */
export async function createPassType(
  sb: Queryable,
  tenantId: string,
  t: NewPassType,
): Promise<void> {
  const { error } = await sb.from('gym_pass_types').insert({
    tenant_id: tenantId,
    name: t.name,
    kind: t.kind,
    price_cents: t.priceCents,
    currency: t.currency,
    uses: t.uses ?? 1,
    valid_days: t.validDays ?? null,
  });
  if (error) throw error;
}

/* ── issued passes ─────────────────────────────────────────────────────────── */

/**
 * Every pass the gym has ever issued, newest first.
 *
 * Capped through src/lib/rowCap.ts, and this one refuses rather than reporting
 * a prefix, for the same reason `fetchVisits` does: truncation here makes a
 * false statement about a NAMED PERSON, not merely a smaller figure.
 *
 * The order is `issued_on desc`, so a truncated read keeps the newest thousand
 * passes and silently drops the older ones. A gym selling twenty drop-ins a
 * week crosses a thousand inside a year, and then:
 *
 *   · /door, the screen the desk actually works from, cannot find a pass that
 *     is still live and turns away somebody who paid for it;
 *   · /members shows a named member's pass history and would say they have
 *     never held one;
 *   · /passes divides passes converted into memberships by passes issued — and
 *     dropping the OLDEST passes drops the ones that had the most time to
 *     convert, so the rate would come out flattering, in the direction that
 *     stops a gym chasing the people it should.
 *
 * There is no honest prefix of this set, so the read refuses and the screens
 * say the passes could not be read.
 */
export async function fetchPasses(sb: Queryable, tenantId: string): Promise<GymPass[]> {
  const { data, error } = await sb
    .from('gym_passes')
    .select(
      'id, pass_type_id, holder_id, holder_name, host_member_id, issued_on, expires_on, ' +
        'uses_total, uses_spent, paid_cents, currency, note, ' +
        'gym_pass_types(name, kind), profiles!gym_passes_holder_id_fkey(full_name)',
    )
    .eq('tenant_id', tenantId)
    .order('issued_on', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data, "this gym's passes").map(rowToPass);
}

function rowToPass(r: any): GymPass {
  const type = Array.isArray(r.gym_pass_types) ? r.gym_pass_types[0] : r.gym_pass_types;
  const holder = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    passTypeId: r.pass_type_id ?? null,
    passTypeName: type?.name ?? null,
    kind: type?.kind ?? null,
    holderId: r.holder_id ?? null,
    // A linked profile's name wins; the desk-written name is the fallback for a
    // walk-in who never made an account.
    holderName: holder?.full_name ?? r.holder_name ?? null,
    hostMemberId: r.host_member_id ?? null,
    issuedOn: r.issued_on,
    expiresOn: r.expires_on ?? null,
    usesTotal: r.uses_total,
    usesSpent: r.uses_spent ?? 0,
    paidCents: r.paid_cents ?? null,
    // Not `?? 'AED'`. The column is NOT NULL and — since supabase/parts/150 —
    // carries NO DEFAULT, so a write that omits the currency fails with 23502
    // rather than filing dirhams nobody chose, and a read always finds one. The
    // branch below therefore does not fire in practice, but "in practice" is
    // what the whole currency bug was made of and it must not invent one.
    // Null flows to money(), which withholds the figure and lets the screen
    // draw a dash.
    currency: r.currency ?? null,
    note: r.note ?? null,
  };
}

export interface IssuePass {
  passType: PassType;
  /** The holder's profile, when they have one. */
  holderId?: string | null;
  /** A name written at the desk, for a walk-in with no account. */
  holderName?: string | null;
  hostMemberId?: string | null;
  /** ISO date. Defaults to today in UTC. */
  issuedOn?: string;
  /** What was actually taken. Defaults to the type's list price. */
  paidCents?: number | null;
  note?: string | null;
}

/**
 * Sell a pass. Uses and expiry are copied from the type at the moment of sale,
 * so later edits to the price book never silently rewrite passes already in
 * someone's hand.
 */
export async function issuePass(sb: Queryable, tenantId: string, p: IssuePass): Promise<void> {
  if (!p.holderId && !(p.holderName ?? '').trim()) {
    throw new Error('A pass needs either a member or a name to be issued to.');
  }
  const issuedOn = p.issuedOn ?? new Date().toISOString().slice(0, 10);
  const { error } = await sb.from('gym_passes').insert({
    tenant_id: tenantId,
    pass_type_id: p.passType.id,
    holder_id: p.holderId ?? null,
    holder_name: p.holderId ? null : (p.holderName ?? '').trim() || null,
    host_member_id: p.hostMemberId ?? null,
    issued_on: issuedOn,
    expires_on: expiryFor(issuedOn, p.passType.validDays),
    uses_total: p.passType.uses,
    paid_cents: p.paidCents === undefined ? p.passType.priceCents : p.paidCents,
    currency: p.passType.currency,
    note: p.note ?? null,
  });
  if (error) throw error;
}

/* ── redemption ────────────────────────────────────────────────────────────── */

/**
 * Take a visit off a pass at the desk.
 *
 * `uses_spent` is not written here — the database trigger recounts it from the
 * redemption rows, so the counter cannot drift from the audit trail. The guard
 * below is a courtesy that gives a readable error; the table's own constraint
 * is what actually holds the line.
 */
export async function redeemPass(
  sb: Queryable,
  pass: GymPass,
  opts: { classId?: string | null; redeemedBy?: string | null; today?: string } = {},
): Promise<void> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  if (remainingUses(pass) === 0) throw new Error('That pass has no visits left on it.');
  if (isExpired(pass, today)) throw new Error(`That pass expired on ${pass.expiresOn}.`);

  const { error } = await sb.from('gym_pass_redemptions').insert({
    pass_id: pass.id,
    class_id: opts.classId ?? null,
    redeemed_by: opts.redeemedBy ?? null,
  });
  if (error) throw error;
}

export async function fetchRedemptions(sb: Queryable, passId: string): Promise<Redemption[]> {
  const { data, error } = await sb
    .from('gym_pass_redemptions')
    .select('id, pass_id, class_id, redeemed_at, redeemed_by')
    .eq('pass_id', passId)
    .order('redeemed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    passId: r.pass_id,
    classId: r.class_id ?? null,
    redeemedAt: r.redeemed_at,
    redeemedBy: r.redeemed_by ?? null,
  }));
}

/** Undo a redemption taken by mistake. The trigger puts the visit back. */
export async function undoRedemption(sb: Queryable, redemptionId: string): Promise<void> {
  const { error } = await sb.from('gym_pass_redemptions').delete().eq('id', redemptionId);
  if (error) throw error;
}
