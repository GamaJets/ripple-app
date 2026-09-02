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

import { assertWhole, capLimit, readAll } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

export type PassKind = 'drop_in' | 'guest' | 'pack';

/**
 * What a pass may be spent ON, as opposed to how it was sold.
 *
 * `kind` says drop-in, guest or pack. It says nothing about whether a credit
 * may pay for an hour of one-to-one, and until supabase/parts/370 nothing did:
 * every pass was spent at the door or against a class. A ten-CLASS pack is not
 * a ten-PT-session pack, so a gym that sells PT through passes says so, and
 * only a 'pt' type is ever drawn by a delivered session.
 *
 * One or the other, never both. A single balance drawn down by two different
 * things is one neither the member nor the desk can predict.
 */
export type PassCovers = 'visit' | 'pt';

export const PASS_COVERS: readonly PassCovers[] = ['visit', 'pt'] as const;

/** How each reads on screen, in the desk's own words rather than the column's. */
export const PASS_COVERS_LABEL: Record<PassCovers, string> = {
  visit: 'Door and classes',
  pt: 'Personal training',
};

export interface PassType {
  id: string;
  name: string;
  kind: PassKind;
  priceCents: number;
  currency: string;
  uses: number;
  /** Days from issue until expiry. Null means it does not expire. */
  validDays: number | null;
  /** What a credit on this type may be spent on. Defaults to 'visit' in the
   *  database, so every type sold before part 370 keeps its old meaning. */
  covers: PassCovers;
  active: boolean;
}

export interface GymPass {
  id: string;
  passTypeId: string | null;
  passTypeName: string | null;
  kind: PassKind | null;
  /** What this pass may be spent on. Null when the type could not be read,
   *  which is NOT the same as 'visit' — an unknown coverage is never counted as
   *  a PT credit and never counted as a class one either. */
  covers: PassCovers | null;
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
// `expiryFor` lives in `./termDates`, a leaf module with no relative imports,
// because `gym-checkout` imports it and Deno cannot resolve an extensionless
// specifier — this file pulls in rowCap and wroteRows and so can never be
// imported by an edge function. Re-exported so every caller here is unchanged.
import { expiryFor } from './termDates';
export { expiryFor };

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
    .select('id, name, kind, price_cents, currency, uses, valid_days, covers, active')
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
    // Never assumed to be 'pt' when the column is missing or unreadable: the
    // default direction is the one that spends nobody's credit by accident.
    covers: r.covers === 'pt' ? 'pt' : 'visit',
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
  /** Omitted means 'visit', which is what the column defaults to and what every
   *  pass sold before part 370 is. A gym opts a type IN to paying for PT. */
  covers?: PassCovers;
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
/**
 * Why this pass type cannot go in the price book, or null when it can.
 *
 * Pure, so the form can say it before the round trip and a test can prove it
 * without a database — the same shape as `slotBlocker` in gymPtSchedule.ts and
 * `inviteBlocker` in memberInvites.ts: null means go.
 *
 * Every rule here is one `gym_pass_types` also enforces (31-drop-ins-and-
 * passes.sql: `price_cents >= 0`, `uses >= 1`, `valid_days is null or > 0`).
 * Duplicating them buys a sentence instead of a raw constraint violation, and
 * it refuses rather than repairs: a blank number is an unfinished form, and
 * defaulting a price to nought would put a free day pass on sale.
 *
 * The currency is checked here as well as required by the type, because this is
 * the sentence the owner reads. A price with no currency is not a price — see
 * the note on createPassType below for what that once cost.
 */
export function passTypeBlocker(t: {
  name?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  uses?: number | null;
  validDays?: number | null;
  covers?: string | null;
}): string | null {
  if (!(t.name ?? '').trim()) return 'Give the pass a name — it is what the desk picks from.';
  if (t.priceCents == null || !Number.isFinite(t.priceCents)) {
    return 'What does it cost? A pass with no price recorded is not a free pass.';
  }
  if (!Number.isInteger(t.priceCents) || t.priceCents < 0) {
    return 'That price cannot be sold — it has to be a whole amount and not less than nothing.';
  }
  if (!(t.currency ?? '').trim()) {
    return 'A price with no currency is not a price. Set the gym’s currency first.';
  }
  if (t.uses != null && (!Number.isInteger(t.uses) || t.uses < 1)) {
    return 'How many visits is it worth? A pass has to be good for at least one.';
  }
  if (t.validDays != null && (!Number.isInteger(t.validDays) || t.validDays < 1)) {
    return 'How many days does it last? Leave it blank for a pass that does not expire — 0 is not the same thing.';
  }
  // Refused rather than repaired. A word this build does not know would be
  // written into a column that decides whether a credit can pay for an hour of
  // somebody's time, and quietly rewriting it to 'visit' would sell a PT pack
  // that pays for nothing.
  if (t.covers != null && t.covers !== 'visit' && t.covers !== 'pt') {
    return 'What is this pass good for? A pass covers the door and classes, or personal training.';
  }
  return null;
}

export async function createPassType(
  sb: Queryable,
  tenantId: string,
  t: NewPassType,
): Promise<void> {
  const blocked = passTypeBlocker(t);
  if (blocked) throw new Error(blocked);
  const { error } = await sb.from('gym_pass_types').insert({
    tenant_id: tenantId,
    name: t.name,
    kind: t.kind,
    price_cents: t.priceCents,
    currency: t.currency,
    uses: t.uses ?? 1,
    valid_days: t.validDays ?? null,
    covers: t.covers ?? 'visit',
  });
  if (error) throw error;
}

/**
 * Take a pass type off sale, or put it back on.
 *
 * Retired, never deleted, exactly as `setPlanActive` retires a plan: passes
 * already in somebody's hand keep pointing at their type, and `fetchPasses`
 * reads the name through that pointer. Deleting the row nulls it (the foreign
 * key is `on delete set null`) and every pass sold on it starts rendering as
 * "retired type" with no name at all — a gym cannot then say what it sold.
 *
 * Counted, because an UPDATE matching zero rows is not an error — see
 * src/lib/wroteRows.ts. `gym_pass_types_owner` is the only policy granting
 * UPDATE and it is `is_owner_of(tenant_id)`, so anybody else retires nothing
 * and, without this, is told a pass is off sale while the desk is still
 * selling it.
 */
export async function setPassTypeActive(
  sb: Queryable, passTypeId: string, active: boolean,
): Promise<void> {
  const r = await sb
    .from('gym_pass_types')
    .update({ active }, { count: 'exact' })
    .eq('id', passTypeId);
  if (r.error) throw r.error;
  assertWrote(active ? 'Putting that pass back on sale' : 'Retiring that pass', r);
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
 * There is no honest prefix of this set — so it is not prefixed. It is FINISHED.
 *
 * Refusing was the first answer and it was the wrong one for this read, for the
 * reason the first bullet above already states: /door is the screen the desk
 * works from, and a refusal there does not merely withhold a figure, it takes
 * the check-in bar and the pass desk away with it. A gym selling twenty
 * drop-ins a week crosses a thousand inside a year, which is a gym doing well
 * at the exact thing this table records. `readAll` pages the set instead
 * (src/lib/rowCap.ts); PAGE_CEILING is what still stops a query that lost its
 * tenant filter. `id` after `issued_on` because paging needs a TOTAL order and
 * two passes sold on the same day are two rows Postgres may return either way
 * round.
 */
export async function fetchPasses(sb: Queryable, tenantId: string): Promise<GymPass[]> {
  const rows = await readAll<any>(
    (from, to) => sb
      .from('gym_passes')
      .select(
        'id, pass_type_id, holder_id, holder_name, host_member_id, issued_on, expires_on, ' +
          'uses_total, uses_spent, paid_cents, currency, note, ' +
          'gym_pass_types(name, kind, covers), profiles!gym_passes_holder_id_fkey(full_name)',
      )
      .eq('tenant_id', tenantId)
      .order('issued_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    "this gym's passes",
  );
  return rows.map(rowToPass);
}

function rowToPass(r: any): GymPass {
  const type = Array.isArray(r.gym_pass_types) ? r.gym_pass_types[0] : r.gym_pass_types;
  const holder = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    passTypeId: r.pass_type_id ?? null,
    passTypeName: type?.name ?? null,
    kind: type?.kind ?? null,
    covers: type?.covers === 'pt' ? 'pt' : type?.covers === 'visit' ? 'visit' : null,
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
 * Take a visit off a pass at the desk — and record the visit it paid for.
 *
 * `uses_spent` is not written here — the database trigger recounts it from the
 * redemption rows, so the counter cannot drift from the audit trail. The guard
 * below is a courtesy that gives a readable error; the table's own constraint
 * is what actually holds the line.
 *
 * ── Why this writes gym_visits too ────────────────────────────────────────
 *
 * It used to write the redemption and nothing else, and the consequence was
 * invisible on the screen that does it: somebody paid for a day pass, walked
 * past the desk into the gym, and left NO record of having been in the
 * building. Not in "Visits today", not in "Inside now", not in the busiest-hour
 * count, not in the door log /members reads a member's attendance out of, and
 * not in any retention figure — every one of which is computed from gym_visits
 * and none of which reads gym_pass_redemptions. A gym selling forty day passes
 * a week read as forty quiet mornings.
 *
 * `gym_visits.pass_id` exists for precisely this and 32-door-log.sql says why
 * in the column comment: "so the two records reconcile instead of double
 * counting the same person". A pass visit written WITHOUT its pass_id is the
 * other half of the same bug — it becomes an ordinary floor visit that cannot
 * be matched back to what paid for it.
 *
 * ── The order, and what a half-failure looks like ─────────────────────────
 *
 * The redemption goes first because it is the entitlement: it is the row the
 * constraint and the trigger police, and the one that decides whether the
 * person is allowed in at all. If it fails, nothing is written and the desk is
 * told why. If the redemption lands and the VISIT is refused, the error names
 * that exact state — the pass was taken, the door log has no record — because
 * the two repairs are different and a desk told only "could not take that pass"
 * would take it a second time and spend two visits off one pass.
 *
 * `tenantId` is optional: `gym_visits_fill_tenant` derives the tenant from
 * `pass_id` when it is not supplied, so a door terminal that does not know the
 * gym cannot supply the wrong one. Callers that do know it pass it, because a
 * stated value needs no trigger to be right.
 */
export async function redeemPass(
  sb: Queryable,
  pass: GymPass,
  opts: {
    classId?: string | null;
    redeemedBy?: string | null;
    today?: string;
    /** The gym, when the caller knows it. Left out, the table's own trigger
     *  fills it in from the pass. */
    tenantId?: string | null;
    /** Set false where the person is NOT entering the building — an
     *  administrative correction rather than somebody walking in. Nothing in
     *  this product does that yet; the flag exists so that when something does,
     *  it has to say so rather than quietly stop writing the visit. */
    recordVisit?: boolean;
  } = {},
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

  if (opts.recordVisit === false) return;

  const { error: vErr } = await sb.from('gym_visits').insert({
    tenant_id: opts.tenantId ?? null,
    // Null for a pass sold to a name at the desk, which is honest: nobody knows
    // whose visit it is. It is still a visit, and it still counts toward the
    // day and toward capacity.
    member_id: pass.holderId ?? null,
    pass_id: pass.id,
    class_id: opts.classId ?? null,
    entered_at: new Date().toISOString(),
    source: 'desk',
  });
  if (vErr) {
    throw new Error(
      `The visit was taken off the pass, but the door log did not record it: ${vErr.message ?? 'the write was refused'}. `
      + 'Do not take the pass again — that would spend a second visit. Add the arrival by hand from Check someone in.',
    );
  }
}

export async function fetchRedemptions(sb: Queryable, passId: string): Promise<Redemption[]> {
  const { data, error } = await sb
    .from('gym_pass_redemptions')
    .select('id, pass_id, class_id, redeemed_at, redeemed_by')
    .eq('pass_id', passId)
    .order('redeemed_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  // The last read in this file without a cap. A single pass cannot hold a
  // thousand redemptions, so this guards the shape of the bug rather than the
  // volume: a `pass_id` filter lost in an edit turns this into every redemption
  // in the database, newest first, rendered as the history of one pass.
  return assertWhole(data as any[] | null, 'the visits taken off this pass').map((r: any) => ({
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
