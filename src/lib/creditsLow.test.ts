// Which clients the coach's Needs Attention flags for credits running low.
// Compile with tsc, run with node.
import { creditsLow, creditsLine, CREDITS_LOW_AT } from './creditsLow';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};
const pack = (id: string, client_id: string | null, total: number | null, used: number, extra: object = {}) =>
  ({ id, client_id, package_id: null, sessions_total: total, sessions_used: used, status: 'paid', created_at: '2026-09-01T00:00:00Z', ...extra });

eq(CREDITS_LOW_AT, 1, 'low means one session or fewer');
eq(creditsLow([pack('a', 'c1', 10, 10)], false), null, 'a partial read flags nobody');
const got = creditsLow([
  pack('a', 'c1', 10, 10),                         // spent, and nothing else
  pack('b', 'c2', 10, 9),                          // one left
  pack('c', 'c3', 10, 10), pack('d', 'c3', 5, 0),  // spent pack plus a fresh one
  pack('e', 'c4', 10, 8),                          // two left
  pack('f', 'c5', null, 0),                        // a membership, not a pack
  pack('g', 'c6', 10, 3, { status: 'refunded' }),  // not paid
  pack('h', 'c7', 5, 5, { expired_at: '2026-09-10T00:00:00Z', sessions_expired: 3 }), // window closed
  pack('i', null, 10, 10),                         // no client on the row
], true)!;
eq([...got.entries()].sort(), [['c1', { left: 0, out: true }], ['c2', { left: 1, out: false }], ['c7', { left: 0, out: true }]],
  'spent and one-left are flagged; a fresh pack, two left, memberships and unpaid rows are not');
eq(creditsLow([], true)!.size, 0, 'a whole read with no sales flags nobody');
eq(creditsLine({ left: 0, out: true }), { state: 'Out of Credits', line: 'No sessions left on their packs.' }, 'out');
eq(creditsLine({ left: 1, out: false }), { state: 'Credits Running Low', line: '1 session left on their packs.' }, 'low');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('creditsLow: ok');
