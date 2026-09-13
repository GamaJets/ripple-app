// The barcode a member holds up at a turnstile, and whether it fits on the card.
// Compile with tsc, run with node.
//
// ── the defect this file exists for ────────────────────────────────────────
//
// app/(client)/access.tsx sized the bars as
//
//     Math.max(1, Math.min(2, available / totalUnits))
//
// The floor of 1 is the bug. The member number widened from four digits to a
// three-letter prefix plus nine base-36 characters (src/lib/membership.ts), and
// at the 3:1 wide-to-narrow ratio that is 239 units including the start and stop
// guards. A 320-point screen — an iPhone SE, or any phone in Display Zoom —
// leaves 224 points inside the white card, so the floor drew 239 points of
// barcode into 224 points of space. The row is centred, so about seven and a
// half points came off EACH END: the guards, which Code 39 cannot be decoded
// without. A full, clean, plausible barcode that scans as nothing.
//
// The assertions below are therefore about one property above all others: the
// symbol NEVER measures more than the space it was given.
import { code39Segments, code39Fit, CODE39_MIN_UNIT, CODE39_MAX_UNIT } from './barcode';
import { memberNoFrom } from './membership';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const widthOf = (text: string, ratio: number) =>
  code39Segments(text, ratio).reduce((n, s) => n + s.w, 0);

/* ── the numbers the screen is actually working with ───────────────────── */

const NO = memberNoFrom('Sara Okafor', 'e3c1a9f0-1111-4222-8333-444455556666', 'Repple');
eq(NO.length, 13, 'a member number is a three-letter prefix, a hyphen and nine characters');
eq(widthOf(NO, 3), 239, 'which is 239 units of Code 39 at 3:1, guards and gaps included');
eq(widthOf(NO, 2), 194, 'and 194 at the equally legal 2:1');

/* ── what the old arithmetic did, kept here so it cannot come back ─────── */
//
// This is not a test of live code. It is the defect, written down: the same
// expression the screen used, fed the same screen width, producing a symbol
// wider than the card it is drawn in.
const OLD = (available: number, units: number) => Math.max(1, Math.min(2, available / Math.max(1, units)));
const SE_AVAILABLE = 320 - 24 * 4;   // sp.xl * 4, as app/(client)/access.tsx computes it
eq(SE_AVAILABLE, 224, 'a 320-point screen leaves 224 points inside the card');
ok(widthOf(NO, 3) * OLD(SE_AVAILABLE, widthOf(NO, 3)) > SE_AVAILABLE,
  'the old floor drew a symbol wider than the card — this is the bug, and it must stay reproducible');

/* ── the property that matters: it always fits ─────────────────────────── */

// Every phone width this app will ever be opened at, the smallest first. 320 is
// an iPhone SE and a zoomed display; 1024 is an iPad in landscape.
const WIDTHS = [280, 300, 320, 344, 360, 375, 390, 393, 414, 428, 430, 768, 1024];
for (const screenW of WIDTHS) {
  const available = Math.max(120, screenW - 24 * 4);
  const fit = code39Fit(NO, available);
  ok(fit.width <= available + 1e-9,
    `at ${screenW}pt the symbol measured ${fit.width} in ${available} points — a clipped Code 39 has lost its guards and decodes as nothing`);
  ok(fit.unit <= CODE39_MAX_UNIT, `at ${screenW}pt the bars must not exceed the cap, got ${fit.unit}`);
  ok(fit.segs.length > 0, `at ${screenW}pt there must be something to draw`);
}

// And on every phone — 320 up — the bars stay at or above the width a scanner
// can resolve. That is the half the 2:1 fallback buys: it is not a compromise,
// it is a WIDER narrow bar than the clipped 3:1 was managing.
for (const screenW of WIDTHS.filter((w) => w >= 320)) {
  const available = Math.max(120, screenW - 24 * 4);
  const fit = code39Fit(NO, available);
  ok(fit.crisp, `at ${screenW}pt the narrow bar fell to ${fit.unit}, under the ${CODE39_MIN_UNIT}pt a laser needs`);
}

const se = code39Fit(NO, SE_AVAILABLE);
eq(se.ratio, 2, 'a 320-point screen falls back to 2:1, because 3:1 does not fit on one');
ok(se.unit > OLD(SE_AVAILABLE, widthOf(NO, 3)),
  `and the fallback bar is WIDER than the clipped one it replaces — ${se.unit} against ${OLD(SE_AVAILABLE, widthOf(NO, 3))}`);

const big = code39Fit(NO, 1024 - 24 * 4);
eq(big.ratio, 3, 'where 3:1 fits it is kept, because it is the ratio a poor scanner copes with best');

/* ── the guards, which are the thing clipping destroys ─────────────────── */

const bare = code39Segments('A', 3);
const withGuards = code39Segments('*A*', 3);
eq(bare.length, withGuards.length,
  'the encoder adds its own start and stop, so a caller must not add them twice');
ok(code39Segments('', 3).length > 0, 'even an empty string encodes as the two guards');

/* ── nothing throws on the degenerate inputs a resize can produce ──────── */

for (const bad of [0, -1, NaN, Infinity]) {
  const fit = code39Fit(NO, bad as number);
  ok(Number.isFinite(fit.unit) && fit.unit >= 0, `an available width of ${bad} must not produce ${fit.unit}`);
  ok(fit.segs.length > 0, `an available width of ${bad} must still return a symbol`);
}

/* ── a prefix Code 39 cannot carry is dropped, not drawn as a gap ──────── */
//
// `memberPrefix` already falls back to MEM for a non-Latin brand, so this is
// belt and braces on the encoder itself.
ok(!code39Segments('REP-مركز', 3).some((s) => Number.isNaN(s.w)),
  'an unencodable character is stripped rather than turned into a NaN-wide bar');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('barcode.test.ts — ok');
