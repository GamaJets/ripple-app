"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The member number on the card and in the entry barcode.
// Compile with tsc, run with node.
//
// The assertion that matters: the number space is large enough that a gym does
// not link two people to one number. The old derivation was `1000 + (h % 9000)`
// — an even chance of a collision at about 112 members, on a number a turnstile
// opens on.
const membership_1 = require("./membership");
const barcode_1 = require("./barcode");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── stable, which is the property it always had ───────────────────────── */
const one = (0, membership_1.memberNoFrom)('Sarah Whitfield', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple');
eq((0, membership_1.memberNoFrom)('Sarah Whitfield', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple'), one, 'the same person gets the same number every time');
eq((0, membership_1.memberNoFrom)('Sarah W', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple'), one, 'and a changed display name does not move it — the id is the seed');
/* ── unique enough that a turnstile can be told about it ───────────────── */
// Ten thousand members of one gym. Under the old nine-thousand-bucket
// derivation this would have collided on essentially every pair of runs.
const seen = new Set();
let collisions = 0;
for (let i = 0; i < 10000; i++) {
    const n = (0, membership_1.memberNoFrom)('', `8f14e45f-ceea-467a-9c7f-${String(i).padStart(12, '0')}`, 'Repple');
    if (seen.has(n))
        collisions++;
    seen.add(n);
}
eq(collisions, 0, 'ten thousand members of one gym share no number');
// Sequential uuids are the hardest case for a weak mix — they differ in one or
// two characters — so the same run is also the avalanche test.
eq(seen.size, 10000, 'and every one of them is distinct');
// A single 32-bit lane collides at about 77,000. Both lanes have to be carrying
// information for the space to be what the header claims.
const hundredK = new Set();
for (let i = 0; i < 100000; i++) {
    hundredK.add((0, membership_1.memberNoFrom)('', `member-${i}`, 'Repple'));
}
eq(hundredK.size, 100000, 'a hundred thousand seeds produce a hundred thousand numbers');
/* ── it has to survive Code 39, which is what the door reads ───────────── */
const ENCODABLE = /^[0-9A-Z\-. $/+%]+$/;
for (const brand of ['Repple', 'Example Fitness', '', 'مركز اللياقة']) {
    for (let i = 0; i < 200; i++) {
        const n = (0, membership_1.memberNoFrom)('', `check-${brand}-${i}`, brand);
        ok(ENCODABLE.test(n), `every character is encodable by Code 39 — ${brand} produced ${n}`);
    }
}
// The renderer drops anything it cannot encode, so a number that loses
// characters on the way to the barcode is a barcode that does not match the
// number printed under it.
const sample = (0, membership_1.memberNoFrom)('', 'render-check', 'Repple');
const clean = sample.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
eq(clean, sample, 'nothing is dropped between the printed number and the bars');
ok((0, barcode_1.code39Segments)(sample).length > 0, 'and it encodes to real segments');
// Fixed width, so the screen that draws it can size itself once.
const widths = new Set();
for (let i = 0; i < 500; i++)
    widths.add((0, membership_1.memberNoFrom)('', `width-${i}`, 'Repple').length);
eq(widths.size, 1, `every number is the same length — got ${JSON.stringify([...widths])}`);
/* ── white-label: the prefix is the brand's, not the supplier's ────────── */
eq((0, membership_1.memberPrefix)('Repple'), 'REP', 'a brand name gives its first three letters');
eq((0, membership_1.memberPrefix)('Example Fitness'), 'EXA', 'spaces are not letters');
eq((0, membership_1.memberPrefix)('X7'), 'MEM', 'a name with too few letters falls back rather than producing a short prefix');
eq((0, membership_1.memberPrefix)(''), 'MEM', 'so does an empty one');
eq((0, membership_1.memberPrefix)(null), 'MEM', 'and an absent one');
eq((0, membership_1.memberPrefix)('مركز'), 'MEM', 'a name Code 39 cannot encode falls back rather than being dropped silently');
ok((0, membership_1.memberNoFrom)('', 'x', 'Example Fitness').startsWith('EXA-'), 'the card carries the gym’s brand, not "RPL"');
ok(!(0, membership_1.memberNoFrom)('', 'x', 'Example Fitness').includes('RPL'), 'and never the supplier’s initials');
/* ── the sentence that stops somebody being refused at a door ──────────── */
ok(/changed in a recent update/.test(membership_1.MEMBER_NO_CHANGED_NOTE), 'the change is admitted');
ok(/give them this one/.test(membership_1.MEMBER_NO_CHANGED_NOTE), 'and the member is told what to do about it');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('membership.test.ts — ok');
