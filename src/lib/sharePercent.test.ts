// A percentage may not say nought about something that happened.
import { sharePercent } from './sharePercent';

process.exitCode = 1;
const errors: string[] = [];
const ok = (c: boolean, msg: string) => { if (!c) errors.push(msg); };
const eq = <T,>(a: T, b: T, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the sentence that was seen on a phone ────────────────────────────────── */
//
// "Booked · 1 session" over "248 open slots · 0% of your slots are filled".
eq(sharePercent(1, 249), 'under 1%', 'one booking in two hundred and forty-nine slots is not none of them');
ok(sharePercent(1, 249) !== '0%', 'and it may never be written as nought');

/* ── nought means nought, and only nought ─────────────────────────────────── */

eq(sharePercent(0, 249), '0%', 'no bookings at all is genuinely nought per cent');
eq(sharePercent(0, 1), '0%', 'however small the book');

/* ── and a hundred means everything ───────────────────────────────────────── */

eq(sharePercent(249, 249), '100%', 'every slot filled is a hundred per cent');
eq(sharePercent(248, 249), 'over 99%', 'and one short of every slot is not');
ok(sharePercent(248, 249) !== '100%', 'a nearly-full week must not read as a full one, because the coach acts on the difference');

/* ── the ordinary middle is left alone ────────────────────────────────────── */

eq(sharePercent(1, 2), '50%', 'half is half');
eq(sharePercent(1, 3), '33%', 'a third rounds the way anybody would expect');
eq(sharePercent(2, 3), '67%', 'and so does two thirds');
eq(sharePercent(1, 100), '1%', 'a real one per cent is written as one per cent, not as "under 1%"');
eq(sharePercent(99, 100), '99%', 'and a real ninety-nine as ninety-nine');

/* ── nothing to be a share OF ─────────────────────────────────────────────── */
//
// Null and '0%' are different sentences: "none of your slots are filled" is
// about a coach who has slots, and a coach with none needs to be told that
// instead.
eq(sharePercent(0, 0), null, 'a whole of nought is not a denominator');
eq(sharePercent(3, 0), null, 'and neither is it one when there is a part');
eq(sharePercent(1, null), null, 'an unread total is not a total of nought');
eq(sharePercent(null, 10), null, 'and an unread part is not a part of nought');
eq(sharePercent(1, undefined), null, 'nor is a missing one');
eq(sharePercent(NaN, 10), null, 'and nothing unreadable produces a figure');
eq(sharePercent(1, Number.POSITIVE_INFINITY), null, 'nor does an infinite one');

/* ── more than everything ─────────────────────────────────────────────────── */

eq(sharePercent(300, 249), '100%', 'more bookings than slots clamps rather than printing a figure over a hundred');
eq(sharePercent(-2, 249), '0%', 'and a negative part is nought rather than a negative percentage');

if (errors.length) {
  console.error(`sharePercent.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
process.exitCode = 0;
console.log('sharePercent.test.ts — ok');
