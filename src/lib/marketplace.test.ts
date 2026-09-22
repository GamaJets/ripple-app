// Marketplace. Compile with tsc, run with node.
//
// The bugs these guard:
//   · a listing with an unreadable price or currency shown as free;
//   · a listing saved with no currency, or a zero price;
//   · a member offered Buy on something they already own;
//   · sales in two currencies summed into one figure.
import { readListings, readPurchases, listingBlocker, nextAction, buyBlocker, salesTotals, statusLabel } from './marketplace';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = { id: 'l1', coach_id: 'c', template_id: 't', title: 'Strong 8', description: '', price_cents: 4900, currency: 'GBP', status: 'live', created_at: '2026-09-01' };
const ls = readListings([row, { ...row, id: 'l2', price_cents: null }, { ...row, id: 'l3', currency: 'gbp' }, { ...row, id: 'l4', status: 'sold' }, { ...row, id: 'l5', price_cents: '1500' }]);
eq(ls.length, 2, 'unreadable price, lowercase currency and unknown status are dropped');
eq(ls[1].priceCents, 1500, 'a numeric string price is read');

const draft = { title: 'Strong 8', description: '', priceCents: 4900, currency: 'JPY', templateId: 't' };
eq(listingBlocker(draft), null, 'a complete listing saves');
ok(listingBlocker({ ...draft, currency: null }) !== null, 'no currency is refused, not defaulted');
ok(listingBlocker({ ...draft, priceCents: 0 }) !== null, 'a zero price is refused');
ok(listingBlocker({ ...draft, priceCents: 12.5 }) !== null, 'a fractional minor amount is refused');
ok(listingBlocker({ ...draft, templateId: null }) !== null, 'a listing needs a template');
ok(listingBlocker({ ...draft, title: '   ' }) !== null, 'a blank title is refused');

eq(nextAction('draft').to, 'live', 'a draft publishes');
eq(nextAction('live').to, 'retired', 'a live listing retires');
eq(nextAction('retired').to, 'live', 'a retired listing can go back on sale');
eq(statusLabel('live'), 'On Sale', 'status reads in words');

const ps = readPurchases([
  { id: 'p1', listing_id: 'l1', buyer_id: 'b', coach_id: 'c', amount_cents: 4900, currency: 'GBP', status: 'paid', created_at: 'x' },
  { id: 'p2', listing_id: 'l1', buyer_id: 'b2', coach_id: 'c', amount_cents: 1000, currency: 'EUR', status: 'paid', created_at: 'x' },
  { id: 'p3', listing_id: 'l1', buyer_id: 'b3', coach_id: 'c', amount_cents: 4900, currency: 'GBP', status: 'pending', created_at: 'x' },
  { id: 'p4', listing_id: 'l1', buyer_id: 'b4', coach_id: 'c', amount_cents: null, currency: 'GBP', status: 'paid', created_at: 'x' },
]);
eq(ps.length, 3, 'a purchase with no readable amount is dropped');
const totals = salesTotals(ps);
eq(totals.length, 2, 'one total per currency');
eq(totals.find((t) => t.currency === 'GBP')?.cents, 4900, 'pending sales are not counted');

ok(buyBlocker(ls[0], [ps[0]]) !== null, 'an owned program cannot be bought again');
eq(buyBlocker(ls[0], [ps[2]]), null, 'an abandoned checkout does not block a retry');
ok(buyBlocker({ ...ls[0], status: 'retired' }, []) !== null, 'a retired listing cannot be bought');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('marketplace: ok');
