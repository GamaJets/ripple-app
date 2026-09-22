// The reads and writes behind the marketplace screens. The rules are in
// src/lib/marketplace.ts (pure, tested); this is the half that talks to the
// server, so it is not in the node test suite.
//
// RLS (supabase/parts/3310) does the scoping: a coach reads and writes their
// own listings, members read LIVE listings on their own tenant, and sales are
// read-only from the app. Every write to a sale is the server's.
import { Linking } from 'react-native';
import { supabase } from './supabase';
import { reportError } from './reportError';
import { signedInUid } from './signedInUid';
import { appLink } from './deepLink';
import { capLimit, capped } from './rowCap';
import { writeFailure } from './wroteRows';
import { readListings, readPurchases, type Listing, type ListingStatus, type MarketPurchase } from './marketplace';
import type { Program } from './programs';
import type { LoadStatus } from '../ui/loadStatus';

const LISTING_COLS = 'id, coach_id, template_id, title, description, price_cents, currency, status, created_at';
const PURCHASE_COLS = 'id, listing_id, buyer_id, coach_id, amount_cents, currency, status, created_at, paid_at';

export interface Read<T> { rows: T[]; status: LoadStatus; uid: string | null }

async function readTable<T>(ctx: string, table: string, cols: string, scope: (q: any, uid: string) => any, parse: (r: any[]) => T[]): Promise<Read<T>> {
  const who = await signedInUid(ctx);
  if (!who.uid) return { rows: [], status: 'error', uid: null };
  try {
    const { data, error } = await scope(supabase.from(table).select(cols), who.uid)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
    if (error) { reportError(ctx, error); return { rows: [], status: 'error', uid: who.uid }; }
    const page = capped(data as any[] | null);
    return { rows: parse(page.rows), status: page.truncated ? 'partial' : 'ready', uid: who.uid };
  } catch (e) {
    reportError(ctx, e);
    return { rows: [], status: 'error', uid: who.uid };
  }
}

/** The coach's own listings, every status. */
export const fetchMyListings = (): Promise<Read<Listing>> =>
  readTable('marketplace.mine', 'marketplace_listings', LISTING_COLS, (q, uid) => q.eq('coach_id', uid), readListings);

/** What is on sale at my gym. RLS limits it to my tenant. */
export const fetchLiveListings = (): Promise<Read<Listing>> =>
  readTable('marketplace.live', 'marketplace_listings', LISTING_COLS, (q) => q.eq('status', 'live'), readListings);

/** Listings by id, for naming purchases (a buyer can read what they bought). */
export async function listingsByIds(ids: string[]): Promise<Listing[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('marketplace_listings').select(LISTING_COLS).in('id', ids);
  if (error) { reportError('marketplace.byIds', error); return []; }
  return readListings(data as any[] | null);
}

/** Sales as the buyer (`as: 'buyer'`) or of my listings (`as: 'coach'`). */
export const fetchMarketPurchases = (as: 'buyer' | 'coach'): Promise<Read<MarketPurchase>> =>
  readTable('marketplace.purchases', 'marketplace_purchases', PURCHASE_COLS,
    (q, uid) => q.eq(as === 'buyer' ? 'buyer_id' : 'coach_id', uid), readPurchases);

/** Null on success, else the sentence to show. */
export async function createListing(d: { templateId: string; program: Program; title: string; description: string; priceCents: number; currency: string }): Promise<string | null> {
  const who = await signedInUid('marketplace.create');
  if (!who.uid) return 'The app could not confirm who you are signed in as, so nothing was saved.';
  try {
    const r = await supabase.from('marketplace_listings').insert({
      coach_id: who.uid, template_id: d.templateId, program: d.program,
      title: d.title.trim(), description: d.description.trim(), price_cents: d.priceCents, currency: d.currency,
    }, { count: 'exact' });
    const why = writeFailure('That program', r);
    if (why) reportError('marketplace.create', new Error(why));
    return why;
  } catch (e) {
    reportError('marketplace.create', e);
    return 'That program did not reach the server, so nothing was saved.';
  }
}

export async function setListingStatus(id: string, status: ListingStatus): Promise<string | null> {
  try {
    const r = await supabase.from('marketplace_listings').update({ status }, { count: 'exact' }).eq('id', id);
    const why = writeFailure('That change', r);
    if (why) reportError('marketplace.status', new Error(why));
    return why;
  } catch (e) {
    reportError('marketplace.status', e);
    return 'That change did not reach the server, so nothing has changed.';
  }
}

/**
 * Start checkout. Same shape as `buyPackage` in src/lib/connect.ts: the
 * server's own sentence on a refusal (including a coach not set up to take
 * payments), and `ok` only once a browser actually opened.
 */
export async function buyListing(listingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const back = appLink('marketplace');
    const { data, error } = await supabase.functions.invoke('marketplace-checkout', { body: { listing_id: listingId, success_url: back, cancel_url: back } });
    // A non-2xx arrives as `error` with the body on its context; read the
    // server's sentence rather than the transport's.
    if (error) {
      let said: string | null = null;
      try { said = (await (error as any).context?.json?.())?.error ?? null; } catch { /* no body */ }
      return { ok: false, error: said || error.message };
    }
    if (!data?.url) return { ok: false, error: data?.error || 'Could not start checkout.' };
    try {
      const opened = await Linking.openURL(data.url);
      if (opened === false) throw new Error('not opened');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Your browser did not open, so nothing has been started and nothing has been charged. Try again in a moment.' };
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
