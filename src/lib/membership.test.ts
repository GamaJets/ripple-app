// The member number on the card and in the entry barcode.
// Compile with tsc, run with node.
//
// The assertion that matters: the number space is large enough that a gym does
// not link two people to one number. The old derivation was `1000 + (h % 9000)`
// — an even chance of a collision at about 112 members, on a number a turnstile
// opens on.
import { memberNoFrom, memberPrefix, MEMBER_NO_CHANGED_NOTE } from './membership';
import { code39Segments } from './barcode';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── stable, which is the property it always had ───────────────────────── */

const one = memberNoFrom('Sarah Whitfield', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple');
eq(memberNoFrom('Sarah Whitfield', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple'), one,
  'the same person gets the same number every time');
eq(memberNoFrom('Sarah W', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple'), one,
  'and a changed display name does not move it — the id is the seed');

/* ── unique enough that a turnstile can be told about it ───────────────── */

// Ten thousand members of one gym. Under the old nine-thousand-bucket
// derivation this would have collided on essentially every pair of runs.
const seen = new Set<string>();
let collisions = 0;
for (let i = 0; i < 10000; i++) {
  const n = memberNoFrom('', `8f14e45f-ceea-467a-9c7f-${String(i).padStart(12, '0')}`, 'Repple');
  if (seen.has(n)) collisions++;
  seen.add(n);
}
eq(collisions, 0, 'ten thousand members of one gym share no number');

// Sequential uuids are the hardest case for a weak mix — they differ in one or
// two characters — so the same run is also the avalanche test.
eq(seen.size, 10000, 'and every one of them is distinct');

// A single 32-bit lane collides at about 77,000. Both lanes have to be carrying
// information for the space to be what the header claims.
const hundredK = new Set<string>();
for (let i = 0; i < 100000; i++) {
  hundredK.add(memberNoFrom('', `member-${i}`, 'Repple'));
}
eq(hundredK.size, 100000, 'a hundred thousand seeds produce a hundred thousand numbers');

/* ── it has to survive Code 39, which is what the door reads ───────────── */

const ENCODABLE = /^[0-9A-Z\-. $/+%]+$/;
for (const brand of ['Repple', 'Example Fitness', '', 'مركز اللياقة']) {
  for (let i = 0; i < 200; i++) {
    const n = memberNoFrom('', `check-${brand}-${i}`, brand);
    ok(ENCODABLE.test(n), `every character is encodable by Code 39 — ${brand} produced ${n}`);
  }
}

// The renderer drops anything it cannot encode, so a number that loses
// characters on the way to the barcode is a barcode that does not match the
// number printed under it.
const sample = memberNoFrom('', 'render-check', 'Repple');
const clean = sample.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
eq(clean, sample, 'nothing is dropped between the printed number and the bars');
ok(code39Segments(sample).length > 0, 'and it encodes to real segments');

// Fixed width, so the screen that draws it can size itself once.
const widths = new Set<number>();
for (let i = 0; i < 500; i++) widths.add(memberNoFrom('', `width-${i}`, 'Repple').length);
eq(widths.size, 1, `every number is the same length — got ${JSON.stringify([...widths])}`);

/* ── white-label: the prefix is the brand's, not the supplier's ────────── */

eq(memberPrefix('Repple'), 'REP', 'a brand name gives its first three letters');
eq(memberPrefix('Example Fitness'), 'EXA', 'spaces are not letters');
eq(memberPrefix('X7'), 'MEM', 'a name with too few letters falls back rather than producing a short prefix');
eq(memberPrefix(''), 'MEM', 'so does an empty one');
eq(memberPrefix(null), 'MEM', 'and an absent one');
eq(memberPrefix('مركز'), 'MEM', 'a name Code 39 cannot encode falls back rather than being dropped silently');

ok(memberNoFrom('', 'x', 'Example Fitness').startsWith('EXA-'),
  'the card carries the gym’s brand, not "RPL"');
ok(!memberNoFrom('', 'x', 'Example Fitness').includes('RPL'),
  'and never the supplier’s initials');

/* ── the sentence that stops somebody being refused at a door ──────────── */

ok(/changed in a recent update/.test(MEMBER_NO_CHANGED_NOTE), 'the change is admitted');
ok(/give them this one/.test(MEMBER_NO_CHANGED_NOTE), 'and the member is told what to do about it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('membership.test.ts — ok');
