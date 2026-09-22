// The two boxes on the profile edit sheet that nothing was checking.
//
// Two families of assertion carry this file.
//
// The first is about SILENCE. The body-fat box was bounded by
// `if (bf != null && bf > 3 && bf < 70)` with no else, so every refusal was
// invisible: the sheet said "Sending…" and closed. These tests pin that an
// out-of-range figure comes back `ok: false` with a sentence, because a reason
// is the only thing that distinguishes a refusal from a save.
//
// The second is about the DECIMAL COMMA. Both boxes are decimal pads and the
// decimal key is a comma across most of Europe. `parseFloat('22,5')` is 22 —
// which is inside the range, so the wrong number would be stored with nothing
// on screen to contradict it. Every reader here goes through `readNumber`.
//
// Height is judged in the unit it was typed in, never converted first: 6 in the
// feet box is a person, and 6 checked against a metric range is six centimetres.
import {
  readBodyFat, readHeight,
  BODY_FAT_MIN, BODY_FAT_MAX, HEIGHT_MIN_CM, HEIGHT_MAX_CM,
} from './bodyEntry';

let failures = 0;
function ok(cond: boolean, what: string) {
  if (!cond) { failures++; console.error('FAIL:', what); } else { console.log('ok  -', what); }
}
const eq = (a: unknown, b: unknown, what: string) =>
  ok(Object.is(a, b), `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

// ── body fat ───────────────────────────────────────────────────────────────

{
  const r = readBodyFat('22');
  ok(r.ok, 'a plain 22 is accepted');
  eq(r.ok ? r.pct : null, 22, '22 reads as 22');
}
{
  // The defect this module exists for. Before it, this returned nothing and the
  // screen said it had saved.
  const r = readBodyFat('85');
  ok(!r.ok, '85% is refused');
  ok(!r.ok && r.reason.includes('70'), 'the refusal names the top of the range');
}
{
  const r = readBodyFat('2');
  ok(!r.ok, '2% is refused');
  ok(!r.ok && r.reason.includes('3'), 'the refusal names the bottom of the range');
}
{
  // Both ends are INCLUSIVE. The old inline test was `> 3 && < 70`, which threw
  // away exactly 3 and exactly 70 without saying so — the same silence one
  // notch narrower.
  ok(readBodyFat(String(BODY_FAT_MIN)).ok, 'the minimum itself is accepted');
  ok(readBodyFat(String(BODY_FAT_MAX)).ok, 'the maximum itself is accepted');
}
{
  const r = readBodyFat('22,5');
  ok(r.ok, 'a decimal comma is read, not truncated');
  eq(r.ok ? r.pct : null, 22.5, '22,5 is 22.5 and not 22');
}
{
  const r = readBodyFat('22.46');
  eq(r.ok ? r.pct : null, 22.5, 'stored at the one decimal place the column holds');
}
{
  const r = readBodyFat('');
  ok(r.ok, 'an empty box is not a refusal');
  eq(r.ok ? r.pct : 'x', null, 'an empty box is null, never zero');
  ok(readBodyFat('   ').ok, 'whitespace is an empty box');
  ok(readBodyFat(null).ok && readBodyFat(undefined).ok, 'null and undefined are empty boxes');
}
{
  const r = readBodyFat('lean');
  ok(!r.ok, 'a word is refused rather than becoming 0');
}
{
  // 0 is a number and is NOT an empty box. It must be refused as out of range
  // rather than waved through as "nothing typed" — the distinction the house
  // rule "null is not zero" is about, read from the other direction.
  const r = readBodyFat('0');
  ok(!r.ok, 'zero is a refusal, not an absent figure');
}

// ── height, metric ─────────────────────────────────────────────────────────

{
  const r = readHeight('175', 'cm');
  ok(r.ok, '175 cm is accepted');
  eq(r.ok ? r.cm : null, 175, '175 cm reads as 175');
}
{
  // The whole reason this half exists: `heightToCm` bounded nothing, so this
  // stored a member seventeen and a half metres tall.
  const r = readHeight('1750', 'cm');
  ok(!r.ok, '1750 cm is refused');
  ok(!r.ok && r.reason.includes(String(HEIGHT_MAX_CM)), 'the refusal names the metric maximum');
}
{
  const r = readHeight('60', 'cm');
  ok(!r.ok, '60 cm is refused');
  ok(!r.ok && r.reason.includes(String(HEIGHT_MIN_CM)), 'the refusal names the metric minimum');
}
{
  ok(readHeight(String(HEIGHT_MIN_CM), 'cm').ok, 'the metric minimum itself is accepted');
  ok(readHeight(String(HEIGHT_MAX_CM), 'cm').ok, 'the metric maximum itself is accepted');
}
{
  const r = readHeight('175,5', 'cm');
  eq(r.ok ? r.cm : null, 175.5, 'a decimal comma in the cm box is read');
}
{
  const r = readHeight('', 'cm');
  ok(r.ok, 'an empty cm box is not a refusal');
  eq(r.ok ? r.cm : 'x', null, 'an empty cm box is null, never zero');
}
{
  ok(!readHeight('tall', 'cm').ok, 'a word in the cm box is refused');
}

// ── height, imperial ───────────────────────────────────────────────────────

{
  const r = readHeight('5', 'in', '10');
  ok(r.ok, "5 ft 10 in is accepted");
  eq(r.ok ? r.cm : null, 177.8, "5 ft 10 in is 177.8 cm");
}
{
  // "Either field may be blank — 5 ft with the inches box empty is five feet
  // exactly", which is the contract `heightToCm` already had and this keeps.
  const r = readHeight('6', 'in', '');
  ok(r.ok, 'feet alone is a height');
  eq(r.ok ? r.cm : null, 182.9, '6 ft is 182.9 cm');
}
{
  // The case a per-box bound would get wrong. 0 ft 70 in and 5 ft 10 in are the
  // same person typed two ways, so the total is what is judged.
  const a = readHeight('', 'in', '70');
  const b = readHeight('5', 'in', '10');
  ok(a.ok && b.ok, 'inches alone is a height');
  eq(a.ok ? a.cm : null, b.ok ? b.cm : 'x', '0 ft 70 in equals 5 ft 10 in');
}
{
  // The imperial twin of 1750 cm: ten inches with the feet box left empty.
  const r = readHeight('', 'in', '10');
  ok(!r.ok, 'ten inches on its own is refused');
  ok(!r.ok && r.reason.includes('ft'), 'the imperial refusal is quoted in feet, not centimetres');
}
{
  const r = readHeight('60', 'in', '');
  ok(!r.ok, '60 feet is refused');
}
{
  const r = readHeight('', 'in', '');
  ok(r.ok, 'both imperial boxes empty is not a refusal');
  eq(r.ok ? r.cm : 'x', null, 'both empty is null, never zero');
}
{
  ok(!readHeight('five', 'in', '10').ok, 'a word in the feet box is refused');
  ok(!readHeight('5', 'in', 'ten').ok, 'a word in the inches box is refused');
}
{
  // A metric range quoted at somebody typing feet is a refusal in a unit they
  // do not use — and, worse, 6 would pass a 90-to-250 check if it were
  // converted first. Neither happens.
  const r = readHeight('6', 'in', '0');
  ok(r.ok, '6 ft is judged as feet, not as 6 cm');
}

console.log(failures === 0 ? '\nbodyEntry: all assertions passed' : `\nbodyEntry: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
