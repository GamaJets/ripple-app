// The one setting a coach could be blocked by forever, and could not reach.
//
// ── The measurement this file exists because of ────────────────────────────
//
// `tenants.currency` is nullable on purpose (part 99) and every money figure in
// the coach app is correctly withheld while it is null. Six screens say so in
// six well-written sentences — analytics.tsx, invoices.tsx, payments.tsx and
// profile.tsx among them — and all six end by telling the coach that "an owner
// sets one in the gym settings".
//
// Counted against the live database on 1 Sep 2026: 54 tenants, 35 of them with
// `currency` null. 34 of those 35 hold no profile at all, so the headline
// number is mostly orphan rows — but of the three OCCUPIED tenants with no
// currency, one is a coach's. And `provision_profile()` creates a personal
// tenant for every new account while inserting no currency and part 99 added no
// default, so every coach who signs up from now on lands in exactly that
// tenant. The number does not stay at one.
//
// ── Why the obvious fix produces a control that cannot work ────────────────
//
// `updateTenant` in src/ui/tenant.tsx can now write the column. It is not
// enough, and part 153 already measured why: `tenants_owner_rw` is the only
// write policy on `tenants`, `is_owner_of(t)` requires `profiles.role =
// 'owner'`, and a coach's role is 'trainer'. Every UPDATE a coach aims at their
// own tenant row matches zero rows. Dropping the owner's currency picker into
// the coach app would have produced a screen that accepts a currency and
// changes nothing — the exact screen part 153 refused to build for branding.
//
// (It would at least SAY so: `updateTenant` counts the returned rows and
// returns false on zero. An honest failure every single time is still a control
// that can never succeed, and offering one is worse than offering none.)
//
// So the coach's route is an RPC — `set_my_tenant_currency()`, in
// supabase/parts/164 — which is security definer and enforces the one condition
// that makes a coach's choice nobody else's business: they are ALONE in that
// tenant. Part 153 established that measurement too ("a personal tenant has
// exactly one occupant, and a gym has staff"), and it is the whole authorisation
// argument here. A coach in a gym has an owner to ask; a coach in a room of one
// has nobody, and today has no way through at all.
//
// ── What is in this file and what is not ───────────────────────────────────
//
// Everything except the network call is pure, because every one of these
// decisions is wrong in a way that reads fine: an unapplied migration reported
// as a refusal sends a coach to support over a deploy step; a refusal reported
// as "offline" makes them try again forever; and a currency that IS set being
// silently overwritten reprices a package somebody already bought. Each is one
// branch below, and src/lib/coachCurrency.test.ts holds both ends of it.
//
// Nothing here imports the Supabase client. That is the rule every tested
// module in src/lib follows and it is enforced by the runner: these tests are
// compiled by tsc and run by plain node, and `src/lib/supabase.ts` builds a
// client at module scope, so one import of it would take this file out of the
// suite entirely. The one impure step — issuing the RPC — lives on the
// provider that already owns every write to `tenants`, in src/ui/tenant.tsx.
import { classifyWrite, type WriteError } from './offlineQueue';

/**
 * The codes offered in the picker.
 *
 * currency-ok: this is the list a coach CHOOSES from, and naming currencies is
 * the entire job of a currency picker. Nothing here is a figure, nothing here
 * is a fallback, and nothing here is applied to anybody's tenant until they tap
 * it. It is deliberately the same eight app/(owner)/ops.tsx offers a gym owner:
 * two pickers writing one column that offered different sets would be a coach
 * and their owner disagreeing about what currencies exist.
 */
export const CURRENCY_CHOICES = ['AED', 'GBP', 'USD', 'EUR', 'SAR', 'AUD', 'CAD', 'ZAR'] as const;

export type CurrencyChoice = (typeof CURRENCY_CHOICES)[number];

/**
 * What became of an attempt to name a currency.
 *
 * 'set'          the tenant now holds it, and the server said so.
 * 'no-tenant'    this account is attached to no gym, so there is nothing to
 *                price. Not a failure and not something to retry.
 * 'shared'       somebody else is in this tenant, which makes it a gym rather
 *                than a room of one. Its owner decides, and this route
 *                deliberately will not overrule them.
 * 'already-set'  it already holds a currency. Refused rather than overwritten —
 *                see `WHY_NOT_A_REPRICE`.
 * 'bad-code'     not three capital letters. Only reachable if a caller invents
 *                a code; the picker cannot produce one.
 * 'unavailable'  the database does not have the function yet — part 164 has not
 *                been applied. A deploy step, not a refusal, and it must not be
 *                reported to a coach as one.
 * 'refused'      the server read it and declined for a reason it did not name.
 * 'unsent'       nothing answered. Nothing was written and nothing was queued:
 *                unlike a check-in this is a settings write with no value to
 *                lose by being typed again, so it is not put on a queue that
 *                would then apply it hours later on some other screen.
 */
export type SetCurrencyOutcome =
  | 'set' | 'no-tenant' | 'shared' | 'already-set' | 'bad-code'
  | 'unavailable' | 'refused' | 'unsent';

/**
 * Why setting a currency is offered ONCE and is not an edit.
 *
 * A currency is not a label on a figure, it is part of the figure. Change it
 * and every stored minor-unit amount that was denominated by it means a
 * different thing — `trainer_packages.price_cents` most of all, which is what a
 * client's card is charged. There is no conversion here and there must not be
 * one: converting stored prices would silently reprice packages people are
 * already paying for, and NOT converting them reprices those packages even more
 * loudly. Neither is a thing a settings screen may do to somebody's customers.
 *
 * So the function refuses a tenant that already has one, and this string is the
 * sentence saying so. Correcting a currency that was set wrong is a support
 * conversation with the rows in front of both people, which is the shape that
 * decision actually has.
 */
export const WHY_NOT_A_REPRICE =
  'Your currency is already set, so this does not change it. Every price you have stored is denominated in it, and changing it here would quietly reprice packages your clients are already paying for. Ask support to change it with your figures in front of you.';

/** Three capital letters, which is `tenants_currency_is_iso` (part 99) restated
 *  where the tap happens. The picker cannot produce anything else; this is the
 *  guard for a caller that is not the picker. */
export function isCurrencyCode(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v);
}

/**
 * True when the error is the migration not being applied rather than a refusal.
 *
 * PostgREST answers a call to a function it cannot find with PGRST202, and
 * Postgres itself with 42883 (undefined_function) if the call gets that far.
 * `classifyWrite` reads both as refusals, correctly — they ARE the server
 * answering, and retrying the same bytes will not change it — but a coach must
 * not be told their currency was declined when the truth is that part 164 has
 * not been run yet. That is a sentence sending the wrong person to look.
 */
export function isMissingFunction(e: WriteError | null | undefined): boolean {
  const code = typeof e?.code === 'string' ? e.code.trim() : '';
  if (code === 'PGRST202' || code === '42883') return true;
  // PostgREST 12 reports an unresolvable function with a 404 and a message
  // naming the schema cache. The code above is the reliable half; this catches
  // the deployment where it arrives without one.
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('could not find the function') || msg.includes('schema cache');
}

/** The jsonb `set_my_tenant_currency()` answers with. Everything is optional
 *  because this is parsed from the wire, and a shape that has drifted must land
 *  on 'refused' rather than on 'set'. */
export interface SetCurrencyReply { ok?: unknown; reason?: unknown; currency?: unknown }

/**
 * The outcome, from the function's own answer.
 *
 * `ok` is checked with `=== true` rather than for truthiness. A reply that
 * arrives as `{}` — a shape change, a proxy rewriting the body, a null — must
 * not be read as success: the whole point of this call is that the coach is
 * told whether their currency is set, and "probably" is not one of the answers.
 */
export function readSetCurrency(reply: SetCurrencyReply | null | undefined): SetCurrencyOutcome {
  if (!reply || typeof reply !== 'object') return 'refused';
  if (reply.ok === true) return 'set';
  switch (reply.reason) {
    case 'no_tenant': return 'no-tenant';
    case 'shared_tenant': return 'shared';
    case 'already_set': return 'already-set';
    case 'bad_code': return 'bad-code';
    default: return 'refused';
  }
}

/**
 * The sentence to put in front of the coach.
 *
 * Every branch says what is true of their gym NOW, because that is the thing
 * they came here to change. None of them says "try again" unless trying again
 * is what would help, and none of them sends the coach to their gym owner
 * unless there is actually an owner: 'shared' is the only outcome where the
 * six screens' existing "an owner sets one in the gym settings" is true, and it
 * is the only one that says it.
 */
export function setCurrencyLine(outcome: SetCurrencyOutcome, code: string): string {
  switch (outcome) {
    case 'set':
      return `You are priced in ${code}. Every figure the app shows you from here on is denominated in it, and every package you put on sale is priced in it.`;
    case 'no-tenant':
      return 'This account is not attached to a gym, so there is nothing here to price. Nothing has changed.';
    case 'shared':
      return 'You share this gym with other people, so its currency is the gym owner’s to set rather than yours. They set one in the gym settings and every screen follows. Nothing has changed.';
    case 'already-set':
      return WHY_NOT_A_REPRICE;
    case 'bad-code':
      return 'That is not a currency code this app can store. Nothing has changed.';
    case 'unavailable':
      return 'Setting your own currency is not switched on for this gym yet. This is a change waiting to be applied to the database rather than anything you have done, and nothing has changed. Your gym owner can still set one in the gym settings.';
    case 'refused':
      return 'Your currency was not saved and the reason was not given. Nothing has changed.';
    case 'unsent':
      return 'Nothing answered, so your currency was not saved and nothing has changed. Try again when you have signal.';
  }
}

/**
 * What an error off the RPC means, for the coach.
 *
 * Three answers out of one error object, and the ORDER is the whole of it. A
 * missing function IS a refusal by every rule `classifyWrite` knows — the
 * server answered, and offering the same bytes again will not change it — so
 * asking `classifyWrite` first reports an unapplied migration as the coach's
 * currency having been declined. That is a sentence that sends the wrong
 * person to look at the wrong thing, and it is the reason `isMissingFunction`
 * is consulted before anything else.
 *
 * `rows` is passed as 1 deliberately. There is no zero-row narrowing to detect
 * on a function call: the reply itself carries the refusal, and `classifyWrite`
 * is only being asked here to separate "the server said no" from "nobody was
 * listening".
 */
export function classifySetCurrencyError(e: WriteError | null | undefined): SetCurrencyOutcome {
  if (!e) return 'refused';
  if (isMissingFunction(e)) return 'unavailable';
  return classifyWrite(e, 1) === 'refused' ? 'refused' : 'unsent';
}
