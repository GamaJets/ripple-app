// Marketplace: a coach sells a ready-made program, built from one of their
// templates, to members of their gym. Tables and the fulfilment rule are in
// supabase/parts/3310; the charge is supabase/functions/marketplace-checkout.
//
// Pure. The reads and writes live in src/ui/marketplace.ts; this file imports
// nothing that builds a Supabase client, so src/lib/marketplace.test.ts can run
// it under plain node.
import { minorMoney } from './coachMoney';

export type ListingStatus = 'draft' | 'live' | 'retired';
export type PurchaseStatus = 'pending' | 'paid' | 'refunded';

export interface Listing {
  id: string;
  coachId: string;
  templateId: string | null;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  createdAt: string;
}

export interface MarketPurchase {
  id: string;
  listingId: string;
  buyerId: string;
  coachId: string;
  amountCents: number;
  currency: string;
  status: PurchaseStatus;
  createdAt: string;
  paidAt: string | null;
}

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

const STATUSES: readonly ListingStatus[] = ['draft', 'live', 'retired'];
const PURCHASE_STATUSES: readonly PurchaseStatus[] = ['pending', 'paid', 'refunded'];
const isCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const whole = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

/**
 * Rows off the wire. A row with no readable price or currency is dropped, not
 * shown with a zero: a price nobody can read is not a price of nothing.
 */
export function readListings(rows: readonly any[] | null | undefined): Listing[] {
  const out: Listing[] = [];
  for (const r of rows ?? []) {
    const price = whole(r?.price_cents);
    const status = STATUSES.find((s) => s === r?.status);
    if (!r?.id || !r?.coach_id || price == null || price <= 0 || !isCode(r?.currency) || !status) continue;
    out.push({
      id: String(r.id), coachId: String(r.coach_id),
      templateId: r.template_id ? String(r.template_id) : null,
      title: String(r.title ?? ''), description: String(r.description ?? ''),
      priceCents: price, currency: r.currency, status, createdAt: String(r.created_at ?? ''),
    });
  }
  return out;
}

export function readPurchases(rows: readonly any[] | null | undefined): MarketPurchase[] {
  const out: MarketPurchase[] = [];
  for (const r of rows ?? []) {
    const amount = whole(r?.amount_cents);
    const status = PURCHASE_STATUSES.find((s) => s === r?.status);
    if (!r?.id || !r?.listing_id || amount == null || !isCode(r?.currency) || !status) continue;
    out.push({
      id: String(r.id), listingId: String(r.listing_id), buyerId: String(r.buyer_id ?? ''), coachId: String(r.coach_id ?? ''),
      amountCents: amount, currency: r.currency, status, createdAt: String(r.created_at ?? ''),
      paidAt: r.paid_at ? String(r.paid_at) : null,
    });
  }
  return out;
}

/** The price as a member reads it, or null when it cannot be stated. */
export const priceLabel = (l: { priceCents: number; currency: string }): string | null => minorMoney(l.priceCents, l.currency);

/**
 * Why this listing cannot be saved, or null. `priceCents` is already minor
 * units (read by `readMinorAmount`, which owns the per-currency decimals), and
 * `currency` is the coach's own, from `fetchMyCurrency`. Null currency is
 * refused, never defaulted.
 */
export function listingBlocker(d: { title: string; description: string; priceCents: number | null; currency: string | null; templateId: string | null }): string | null {
  if (!d.templateId) return 'Choose one of your saved programs to sell.';
  const title = d.title.trim();
  if (!title) return 'Give it a title members will recognise.';
  if (title.length > TITLE_MAX) return `Keep the title to ${TITLE_MAX} characters.`;
  if (d.description.length > DESCRIPTION_MAX) return `Keep the description to ${DESCRIPTION_MAX} characters.`;
  if (!isCode(d.currency)) return 'There is no currency to price this in yet.';
  if (d.priceCents == null || !Number.isInteger(d.priceCents) || d.priceCents <= 0) return 'Enter a price greater than 0.';
  return null;
}

/** What a coach can do to a listing next, as the one button they see. */
export function nextAction(s: ListingStatus): { to: ListingStatus; label: string } {
  if (s === 'live') return { to: 'retired', label: 'Retire' };
  return { to: 'live', label: s === 'draft' ? 'Publish' : 'Put Back On Sale' };
}

export const statusLabel = (s: ListingStatus | PurchaseStatus): string =>
  ({ draft: 'Draft', live: 'On Sale', retired: 'Retired', pending: 'Awaiting Payment', paid: 'Paid', refunded: 'Refunded' })[s];

/**
 * Why a member cannot buy this, or null. Already owning it is the one reason
 * the app knows before asking the server; everything about the coach's payment
 * setup is the server's to say (connect-checkout's sentence, word for word).
 */
export function buyBlocker(l: Listing, mine: readonly MarketPurchase[]): string | null {
  if (l.status !== 'live') return 'This program is no longer on sale.';
  if (mine.some((p) => p.listingId === l.id && p.status === 'paid')) return 'You already own this program. It is on your Train tab.';
  return null;
}

/** Paid sales only, summed per currency. Never across currencies. */
export function salesTotals(rows: readonly MarketPurchase[]): { currency: string; cents: number; count: number }[] {
  const by = new Map<string, { currency: string; cents: number; count: number }>();
  for (const p of rows) {
    if (p.status !== 'paid') continue;
    const pot = by.get(p.currency) ?? { currency: p.currency, cents: 0, count: 0 };
    pot.cents += p.amountCents; pot.count += 1;
    by.set(p.currency, pot);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
