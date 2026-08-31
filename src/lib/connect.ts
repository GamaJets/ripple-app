// Stripe Connect (marketplace) — trainers get paid by their clients. Trainers
// onboard an Express account and sell packages (memberships / session-packs);
// clients buy via Stripe Checkout, funds go to the trainer minus the platform fee.
// Trainers manage packages directly (RLS); money flows through the connect-* edge
// functions. Credential-ready: activates once Stripe Connect is enabled + keys set.
import { Linking } from 'react-native';
import { appLink } from './deepLink';
import { supabase } from './supabase';
import { reportError } from './reportError';
import { capLimit, capped, TruncatedRead, ROW_CAP } from './rowCap';
import { writeFailure } from './wroteRows';
import { packBalance, readDraw, drew, drawReason, type PackPurchase, type PackBalance } from './packDraw';
import type { LoadStatus } from '../ui/loadStatus';

export interface ConnectStatus { stripe_account_id: string | null; charges_enabled: boolean; details_submitted: boolean }
/**
 * A thing a trainer sells.
 *
 * `sessions` and `billing_interval` are the two axes, and part 97 forbids both
 * at once: null/null is a one-off membership, N sessions is a pack bought once
 * and drawn down, and 'month'/'year' is a subscription that charges again.
 *
 * `currency` is per package and is the only currency any figure about that
 * package may be printed in — never a literal, and never the gym's current
 * setting either, because a package sold last year in one currency was sold in
 * that one whatever the gym charges in today.
 *
 * The column still carries `default 'usd'` from 21-connect, which predates the
 * product being white-labelled and should inherit the tenant's currency
 * instead. Nothing in this file relies on it: `createPackage` refuses to insert
 * without an explicit currency, so the default is never the value that lands.
 * See `pkgMoney` in src/lib/subscriptions.ts and tenants.currency in part 99.
 */
export interface TrainerPackage { id: string; trainer_id: string; name: string; price_cents: number; currency: string; sessions: number | null; billing_interval: string | null; active: boolean }
/** A completed one-off sale. `client_id` was missing from this type for as long
 *  as every function reading the table filtered on it — the client-side reads
 *  never needed to look at a column they were already scoped by. The coach-side
 *  read below is scoped by `trainer_id`, so who bought it is the thing it has to
 *  say. Note what is NOT here: there is no currency column on this table at
 *  all, which is why an amount from it is only printable alongside the package
 *  it was sold from. */
export interface Purchase { id: string; client_id: string | null; trainer_id: string | null; package_id: string | null; amount_cents: number | null; sessions_total: number | null; sessions_used: number; status: string; created_at: string;
  /** The unit this sale's money actually moved in, written at checkout from
   *  the Stripe session (part 132). Null on rows written before that column
   *  existed whose package has since been deleted — genuinely unrecoverable,
   *  and reported as an amount missing from a total rather than summed into
   *  one. Not to be confused with the package's currency, which is a lookup
   *  that can change underneath a sale that already happened. */
  currency?: string | null }

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/** Start / resume Stripe Express onboarding for the signed-in trainer. */
export async function startTrainerOnboarding(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboard', { body: { refresh_url: appLink('connect/refresh'), return_url: appLink('connect/return') } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start onboarding.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The signed-in trainer's Connect account status. */
export async function fetchMyConnect(): Promise<ConnectStatus | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    // A refused read used to fall through to the same default a trainer with no
    // account gets — telling somebody who IS set up for payments that they are
    // not. null means "could not read"; the caller renders that differently.
    const { data, error } = await supabase.from('connect_accounts').select('*').eq('trainer_id', uid).maybeSingle();
    if (error) { reportError('connect.fetchMyConnect', error); return null; }
    return (data as ConnectStatus) ?? { stripe_account_id: null, charges_enabled: false, details_submitted: false };
  } catch { return null; }
}

/**
 * Packages the signed-in trainer sells.
 *
 * `[]` means they sell none. **`null` means we could not read them**, which the
 * payments screen must not render as "no packages yet" — a trainer told that
 * about their own price list will build it a second time, and their clients see
 * duplicates of everything they already sell.
 */
export async function fetchMyPackages(): Promise<TrainerPackage[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', uid).order('created_at', { ascending: false });
    if (error) return null;
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * Put a package on sale.
 *
 * `billing_interval` omitted or null keeps the behaviour every existing caller
 * had: a one-off charge. 'month' or 'year' makes it a subscription, and the
 * client is then charged again every month or year until somebody stops it —
 * which is a large enough difference that it is never inferred from anything,
 * only ever passed in explicitly.
 */
export async function createPackage(p: { name: string; price_cents: number; sessions: number | null; currency: string; billing_interval?: 'month' | 'year' | null }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    // No fallback currency, on purpose. This used to be `p.currency || 'usd'`,
    // which is a literal that silently applies — and Repple is white-labelled,
    // so there is no currency that is right for both a London gym and a Dubai
    // one. A package with no currency is not created; the coach is told the gym
    // has not set one. See tenants.currency (part 99).
    const currency = (p.currency || '').trim();
    if (!currency) return { ok: false, error: 'Your gym has not set a currency yet, so there is nothing to price this in. An owner sets it in the gym settings.' };
    const interval = p.billing_interval ?? null;
    // Part 97 refuses this combination in the database; refusing it here too
    // turns a constraint violation into a sentence. A recurring pack would
    // charge again every month for credits that are granted once.
    if (interval && p.sessions != null) return { ok: false, error: 'A recurring package cannot also be a session pack — sessions are granted once and nothing renews them.' };
    const { error } = await supabase.from('trainer_packages').insert({ trainer_id: uid, name: p.name, price_cents: p.price_cents, sessions: p.sessions, billing_interval: interval, currency, active: true });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Stop selling a package. Returns whether it actually stopped.
 *
 * Returned void and swallowed the error, so the screen refreshed and said
 * nothing either way — a trainer who "removed" a package that is still on sale
 * keeps selling something they believe they withdrew, and finds out when
 * somebody buys it.
 */
export async function deactivatePackage(id: string): Promise<boolean> {
  try {
    // `!error` was not "whether it actually stopped", which is what the line
    // above promises and what payments.tsx branches on. `pkg_write` is
    // `trainer_id = auth.uid()`, and `pkg_read` publishes every ACTIVE package
    // to everybody — so an id this trainer can see is not necessarily one they
    // may write, and an UPDATE matching no row comes back 204 with `error`
    // null. Proved live against phgfwzpkkwdysftlgkoq with a second seeded
    // coach: SELECT of the other coach's active package returned 1 row, the
    // UPDATE of it affected 0 and raised nothing.
    //
    // A stale id does the same thing, which is the version that reaches a
    // trainer with one account: the list is from before a refresh, the package
    // was already withdrawn elsewhere, and the screen confirms a second
    // withdrawal that changed nothing. The count is the only proof there is.
    const r = await supabase.from('trainer_packages').update({ active: false }, { count: 'exact' }).eq('id', id);
    return writeFailure('That package', r) === null;
  } catch { return false; }
}

/**
 * Active packages a client can buy from a given trainer.
 *
 * `[]` means this trainer sells none. **`null` means we could not read them** —
 * the same distinction fetchMyPackages already makes, and this twin did not.
 * A client shown "this coach sells nothing" because a read failed is a lost
 * sale explained as a fact about the coach.
 */
export async function fetchTrainerPackages(trainerId: string): Promise<TrainerPackage[] | null> {
  try {
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', trainerId).eq('active', true).order('price_cents', { ascending: true });
    if (error) { reportError('connect.fetchTrainerPackages', error); return null; }
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * The currency each of a set of packages is priced in.
 *
 * `client_purchases` records `amount_cents` and no currency at all, so the only
 * place the unit of a past purchase is written down is the package it was
 * bought from. That makes an amount unlabelled whenever the package row is
 * actually GONE — deleted, not merely withdrawn — and an unlabelled amount
 * renders as a dash rather than as a number in a currency we picked. A
 * withdrawn package used to land here too, because pkg_read was `active or
 * trainer_id = auth.uid()`; part 147 gives the buyer their own purchases back,
 * so a coach retiring a pack no longer un-labels the money somebody paid.
 *
 * Ids absent from the returned map are ids we could not label. A read that
 * fails returns an empty map, which lands in the same place: dashes, not
 * dollars.
 */
export async function packageCurrencies(ids: string[]): Promise<Map<string, string>> {
  const labelled = await packageLabels(ids);
  const out = new Map<string, string>();
  labelled.forEach((v, k) => { if (v.currency) out.set(k, v.currency); });
  return out;
}

/**
 * The name AND the currency of a set of packages, in one read.
 *
 * Both live on the same row and both are missing in the same circumstances, so
 * fetching them separately was two round trips that could disagree. What a
 * client can see of that row is decided by `pkg_read`. Since part 147 that is:
 * my own row, my current coach's rows that are still on sale, and — the arm
 * this function depends on — every package I have actually bought or subscribed
 * to, on sale or not, from a current coach or a former one. So a withdrawn pack
 * a client paid for still labels itself. A package actually DELETED is
 * unreadable to everybody, and that is the only case left that lands below.
 *
 * An id absent from the map is a package we could not read. That is not a
 * package with no name and no currency: the screen DESCRIBES such a pack by its
 * size (`packLabel` in packDraw.ts) rather than naming it, and prints a dash
 * where the amount would go rather than a figure in a currency we chose.
 */
export async function packageLabels(ids: string[]): Promise<Map<string, { name: string | null; currency: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  try {
    const { data, error } = await supabase.from('trainer_packages').select('id, name, currency').in('id', unique).limit(capLimit());
    if (error) { reportError('connect.packageLabels', error); return new Map(); }
    const out = new Map<string, { name: string | null; currency: string | null }>();
    ((data as { id: string; name: string | null; currency: string | null }[]) ?? []).forEach((p) => {
      if (p?.id) out.set(p.id, { name: (p.name || '').trim() || null, currency: (p.currency || '').trim() || null });
    });
    return out;
  } catch (e) { reportError('connect.packageLabels', e); return new Map(); }
}

/** Client buys a package → Stripe Checkout (funds to the trainer, minus fee). */
export async function buyPackage(packageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', { body: { package_id: packageId, success_url: appLink('purchase/success'), cancel_url: appLink('purchase/cancel') } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * The signed-in client's purchases (session-pack balances).
 *
 * `[]` means they have bought nothing. **`null` means we could not read it** —
 * and the packages screen renders "No purchases yet" for an empty list, so a
 * refused read told a paying customer their money bought nothing. That is the
 * single worst sentence this app can show someone who has paid.
 */
export async function fetchMyPurchases(): Promise<Purchase[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    // Capped, and a truncated read answers `null` — the same answer as a
    // refusal, because to the caller it is the same fact.
    //
    // This was the only purchase read in the file with no `.limit()`, while
    // `packageLabels`, `sessionsRemaining` and `fetchClientPurchases` all carry
    // one. It matters more here than in any of them: these rows go straight
    // into `packBalance`, whose entire output is a FIGURE — how many sessions
    // the client has left — and rowCap.ts's rule for a figure over a partial
    // set is that it is not a smaller number, it is a wrong one. A client whose
    // history was cut off would be shown a balance short by whatever fell past
    // the cap, and would book against it.
    //
    // Null rather than a rows-plus-flag pair because every caller of this
    // function already renders null correctly, with a written sentence — "this
    // is our end, not a statement about what you have bought" — and that
    // sentence is true of a truncated read as well.
    const { data, error } = await supabase.from('client_purchases').select('*').eq('client_id', uid)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
    if (error) return null;
    const page = capped((data as Purchase[]) ?? []);
    if (page.truncated) {
      reportError('connect.fetchMyPurchases', new TruncatedRead('your purchase history', ROW_CAP));
      return null;
    }
    return page.rows;
  } catch { return null; }
}

/**
 * Sessions remaining across the client's active packs (optionally for one trainer).
 *
 * **`null` means we could not count them**, and is not the same as `0`.
 *
 * This returned `0` on a failed read, which is a number, and a wrong one. Two
 * things on the calendar screen are decided by it, and a fabricated zero got
 * both backwards for the one client it matters most to — somebody holding
 * credits whose read just failed:
 *
 *   - the "Pack credits" row silently disappears, so they cannot see the
 *     balance they paid for;
 *   - `hadCredits` goes false, which SUPPRESSES the warning that a booking was
 *     not drawn from their pack. They book, nothing is deducted, and the app
 *     says nothing at all, because it believes there was no pack to deduct from.
 *
 * The two functions on either side of this one — `fetchMyPurchases` above and
 * `redeemSession` below — were both fixed for exactly this. This one was
 * missed, and it feeds the screen the other two protect.
 */
export async function sessionsRemaining(trainerId?: string): Promise<number | null> {
  // One place does this arithmetic, and it is tested: `packBalance` returns
  // null for an unread history and a real 0 for an empty one, which is the
  // distinction this function exists to preserve. See src/lib/packDraw.ts.
  return (await sessionPacks(trainerId))?.left ?? null;
}

/**
 * The same read, keeping the PACKS as well as the number left on them.
 *
 * `sessionsRemaining` throws the lines away, and a caller holding only the
 * number cannot tell 0-because-you-used-them-all from 0-because-you-have-never-
 * bought-one. app/(client)/pt-sessions.tsx was showing the second as the first:
 * with `client_purchases` empty, every member read a hero of "0 · Nothing left
 * on a pack" and an amber flag telling them to "Buy another" — two sentences
 * asserting a pack that never existed, to somebody who may not even have a
 * coach. app/(client)/packages.tsx already guarded the identical warning with
 * `balance.lines.length > 0`; it simply had the lines to hand and this screen
 * did not.
 *
 * Null still means the read did not land, exactly as before.
 */
export async function sessionPacks(trainerId?: string): Promise<PackBalance | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    let q = supabase.from('client_purchases').select('id, package_id, sessions_total, sessions_used, status, created_at').eq('client_id', uid).eq('status', 'paid').not('sessions_total', 'is', null).limit(capLimit());
    if (trainerId) q = q.eq('trainer_id', trainerId);
    const { data, error } = await q;
    if (error) { reportError('connect.sessionsRemaining', error); return null; }
    if (!data) return null;
    return packBalance(data as PackPurchase[]);
  } catch (e) { reportError('connect.sessionsRemaining', e); return null; }
}

/**
 * One purchase as the COACH sees it: the row, plus the two labels that live in
 * other tables and the currency that lives in no table at all.
 */
export interface CoachPurchase extends Purchase {
  /** null when the name could not be read. The money beside it is still real. */
  client_name: string | null;
  /** null when the package has been deleted since the sale. */
  package_name: string | null;
  /**
   * From the PACKAGE. `client_purchases` has no currency column — checked
   * against the live schema — so this is null whenever the package row is gone,
   * and an amount with a null currency is printed as a dash rather than as a
   * number in a unit we picked. See `sumTaken` in coachMoney.ts, which counts
   * those separately instead of quietly leaving them out of the total.
   */
  currency: string | null;
}

/**
 * What the signed-in coach's clients have bought from them — one-off
 * memberships and session packs, newest first.
 *
 * The twin of `fetchMyPurchases` below, from the other side of the sale. Every
 * purchase function in this file filters on `client_id = uid`, so until now a
 * coach could not see who had bought a ten-pack, how many sessions were left on
 * it, or who had run out — the app took money on their behalf and then showed
 * them nothing about it.
 *
 * No new policy was needed for this: `cp_trainer_read` on `client_purchases`
 * already grants SELECT where `trainer_id = auth.uid()`, and `purch_read`
 * grants the same to the gym owner. Verified live before writing this.
 *
 * Returns the rows AND how far they can be trusted, because the three answers a
 * coach can get look identical as a list: 'ready' with nothing is a coach
 * nobody has bought from, 'error' with nothing is a coach who could not be
 * told, and 'partial' is more sales than one read returns — on which no total
 * may be quoted. This is somebody's income; "nothing" and "unknown" are not the
 * same sentence about it.
 */
export async function fetchClientPurchases(): Promise<{ rows: CoachPurchase[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_purchases').select('*')
      .eq('trainer_id', uid).order('created_at', { ascending: false }).limit(capLimit());
    if (error) { reportError('connect.fetchClientPurchases', error); return { rows: [], status: 'error' }; }
    const page = capped((data as Purchase[]) ?? []);

    // The package carries the name AND the unit. A coach reads their own
    // packages whether or not they are still on sale (pkg_read is `active OR
    // trainer_id = uid`), so withdrawing a package does not un-label the sales
    // made from it — which is exactly what happens to the CLIENT, who can only
    // see active ones. A package actually DELETED still leaves an amount with
    // no unit, and that is unrecoverable rather than unread.
    const pkgIds = [...new Set(page.rows.map((r) => r.package_id).filter(Boolean))] as string[];
    const pkgs = new Map<string, { name: string | null; currency: string | null }>();
    if (pkgIds.length) {
      // no-error-ok: a package we cannot read leaves the sale unlabelled and unpriced-in-anything, which is the same outcome as a package that was deleted — and both are reported by sumTaken as amounts missing from the total, never as dollars
      const { data: rows } = await supabase.from('trainer_packages').select('id, name, currency').in('id', pkgIds).limit(capLimit());
      (rows ?? []).forEach((p: any) => { if (p?.id) pkgs.set(p.id, { name: (p.name || '').trim() || null, currency: (p.currency || '').trim() || null }); });
    }

    const clientIds = [...new Set(page.rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (clientIds.length) {
      // Bounded by `clientIds`, which the cap above already holds at ROW_CAP or fewer.
      // no-error-ok: a name we cannot read stays null and renders as a dash; the purchase it labels is still real and still paid for
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', clientIds).limit(capLimit());
      (profs ?? []).forEach((p: any) => { if (p?.id) names.set(p.id, (p.full_name || '').trim()); });
    }

    const rows: CoachPurchase[] = page.rows.map((r) => ({
      ...r,
      client_name: (r.client_id && names.get(r.client_id)) || null,
      package_name: (r.package_id && pkgs.get(r.package_id)?.name) || null,
      // The SALE's own currency first, the package's only as a fallback.
      //
      // `client_purchases.currency` (part 132) is written at checkout from the
      // Stripe session's own currency — the unit the money actually moved in.
      // The package is a lookup that can change or be deleted underneath it,
      // and reading the package first is how a sale loses its unit the moment
      // somebody tidies their price list. Existing rows were backfilled from
      // their package where one survived, so the two agree wherever both exist.
      currency: (r.currency || '').trim() || (r.package_id && pkgs.get(r.package_id)?.currency) || null,
    }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('connect.fetchClientPurchases', e); return { rows: [], status: 'error' }; }
}

/**
 * Draw down one credit from the client's oldest active pack for a trainer.
 *
 * ── Why this is one RPC and not the read-then-write it used to be ──────────
 *
 * It used to select the packs, pick one in JavaScript, and UPDATE the row it
 * had picked. Three things were wrong with that, and all three were confirmed
 * against the live database before this was changed (see
 * supabase/parts/123-a-credit-is-spent-once.sql):
 *
 *   · **The write could not report doing nothing.** PostgREST resolves an
 *     UPDATE that matched zero rows with `error: null` and an empty body. This
 *     function checked `error` — the only thing it had — and returned `ok:
 *     true` with a `remaining` it had worked out ITSELF, from the row it read
 *     a moment earlier. A balance the app printed and the database never
 *     agreed to. (An adversarial review said this meant packs never
 *     decremented at all; that half was wrong — `cp_self` is FOR ALL and the
 *     write does match its own row, proven live. The bug was that nothing
 *     could tell the difference.)
 *
 *   · **It was a lost update.** Two bookings in flight both read
 *     `sessions_used = 3`, both wrote 4, and two sessions came off one credit.
 *
 *   · **Nothing bounded the column.** `sessions_used = 500` on a ten-pack was
 *     accepted, live, as the client. Part 123 adds the CHECK constraint.
 *
 * `redeem_pack_session` does the pick and the write in one statement, holds the
 * chosen row with `for update`, and RAISES when its own `row_count` is not 1.
 * So the three answers below are the database's, not this file's:
 *
 *   ok: true            a credit came off. `remaining` is what the DATABASE
 *                       now holds — never a number computed here.
 *   ok: false + error   nothing came off, and `error` says why. It is a
 *                       lower-case clause: app/(client)/calendar.tsx renders
 *                       it inside parentheses mid-sentence.
 *   ok: false, no error the client has no pack with this coach at all. Nothing
 *                       was supposed to happen and nothing is explained.
 *
 * A thrown/refused call is `ok: false` with a reason — never silently the same
 * as "you have none left", which is what a paying client would otherwise be
 * told when the server simply could not be reached.
 */
export async function redeemSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('redeem_pack_session', { p_trainer: trainerId });
    if (error) {
      reportError('connect.redeemSession', error);
      return { ok: false, error: 'the server did not confirm it — this is not the same as having none left' };
    }
    // Zero rows back is not a redemption. `readDraw` is the row count this
    // function never had: [] and [row, row] and a word from a newer schema are
    // all 'unknown', and 'unknown' never reads as success.
    const d = readDraw(data);
    if (drew(d)) return d.remaining == null ? { ok: true } : { ok: true, remaining: d.remaining };
    const why = drawReason(d);
    return why ? { ok: false, error: why } : { ok: false };
  } catch (e) {
    reportError('connect.redeemSession', e);
    return { ok: false, error: 'the server did not confirm it — this is not the same as having none left' };
  }
}

/** The trainer OTHER clients, to push a freed slot to. Server-side lookup so no
 *  other-client identity leaks to the caller beyond opaque ids. */
export async function reofferSlot(sessionId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('reoffer_client_ids', { p_session: sessionId });
    if (error) { reportError('connect.reofferSlot', error); return []; }
    return Array.isArray(data) ? data.map((r: any) => r.client_id).filter(Boolean) : [];
  } catch { return []; }
}

/**
 * Refund one credit — the client cancelled outside the window and it goes back
 * onto their pack. The exact inverse of `redeemSession`, through the same kind
 * of RPC and for the same reasons: the old version read, picked, and wrote,
 * and its final `return { ok: !error }` treated a write that matched nothing as
 * a credit successfully returned. A credit believed returned and not returned
 * is one the client has paid for twice.
 *
 * WHETHER a refund is owed is not decided here. `cancelBookedSession` in
 * src/ui/sessions.tsx applies the 24-hour rule and only calls this when a
 * credit is due; `refund_pack_session` decides which pack it lands on (the
 * newest with usage, the inverse of drawing from the oldest with room).
 *
 * `ok` is true only when the database says a credit moved. `reason` is why it
 * did not, when there is something worth saying — 'nothing had been drawn off
 * it', or the one that matters, 'we could not confirm the change'. Callers that
 * only read `.ok` (src/ui/sessions.tsx does) keep exactly their old behaviour.
 */
export async function refundSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc('refund_pack_session', { p_trainer: trainerId });
    if (error) {
      reportError('connect.refundSession', error);
      return { ok: false, reason: 'the server did not confirm it' };
    }
    const d = readDraw(data);
    if (drew(d)) return d.remaining == null ? { ok: true } : { ok: true, remaining: d.remaining };
    const why = drawReason(d);
    return why ? { ok: false, reason: why } : { ok: false };
  } catch (e) {
    reportError('connect.refundSession', e);
    return { ok: false, reason: 'the server did not confirm it' };
  }
}
