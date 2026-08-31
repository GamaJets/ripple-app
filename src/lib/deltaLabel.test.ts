// A movement that did not happen may not be given a sign.
// Compile with tsc, run with node.
//
// The bug this suite is written against shipped, and was found by walking the
// client Progress screen: the body-fat hero read "−0% since Aug 25, 2026". The
// expression behind it was `bfMove <= 0 ? '−' : '+'`, so an unchanged reading
// took the minus arm — and a small drop in body fat is the kind of small drop a
// member is pleased about. The app reported progress that had not occurred.
//
// Every block below is a form that defect took somewhere in the app:
//
//   SIGNED ZERO      the literal bug, in all four ways it was written
//   ROUNDED TO ZERO  the same lie one step later — a raw 0.04 printed as "0.0"
//                    with a sign in front of it
//   NO BASELINE      "+2 kg" against what, and since when
//   UNREADABLE       Infinity and NaN out of a divide by a zero baseline,
//                    interpolated into a sentence that never reaches fig()
//   DIRECTION        whose goal decides which way is good
//
// Mutation-checked: every assertion here has been run against the plausible
// wrong versions — the signed zero restored (`f <= 0 ? MINUS : '+'`), the
// rounding ignored (zero-testing the raw value rather than the printed one),
// and `pctChange` dropping its `before === 0` guard. Each one fails this suite.
import {
  MINUS, deltaLabel, deltaSign, deltaArrow, deltaMoved, deltaFigure,
  deltaMagnitude, goalWants, movementIsProgress, pctChange,
} from './deltaLabel';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
// JSON.stringify renders Infinity and NaN as "null", which is exactly the pair
// this suite exists to tell apart from null — a failure that read "got null,
// wanted null" would hide the defect inside its own report.
const show = (v: unknown) =>
  typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v);
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${show(a)}, wanted ${show(b)}`);

/* ── SIGNED ZERO ──────────────────────────────────────────────────────────
 *
 * Zero takes a word, never a sign. Not a plus, not a minus, and not an arrow:
 * an arrow is a sign drawn as a triangle and carries the same claim.
 */
{
  eq(deltaLabel(0, { since: 'Aug 25', unit: '%' }), 'No change since Aug 25',
    'an unchanged body fat says so rather than printing −0%');
  eq(deltaLabel(0, { since: null, unit: 'kg' }), 'No change',
    'with no baseline named, an unchanged figure is still not signed');
  eq(deltaSign(0), '', 'zero has no sign');
  eq(deltaSign(-0), '', 'negative zero has no sign either — it is the same nothing');
  eq(deltaArrow(0), '', 'zero draws no arrow, rather than picking the down one');
  eq(deltaMoved(0), false, 'zero did not move');

  // The bug as it was actually written, and the three other ways the same
  // expression appeared across the app. All four produced a sign for zero;
  // whichever sign depended on nothing but the author.
  ok(!deltaLabel(0, { since: 'Aug 25', unit: '%' }).includes(MINUS),
    'no minus anywhere in the unchanged line');
  ok(!deltaLabel(0, { since: 'Aug 25', unit: '%' }).includes('+'),
    'and no plus either');

  // Either side of zero still signs, and signs in the app's own MINUS.
  eq(deltaLabel(-1.2, { since: 'Aug 25', unit: 'kg' }), `${MINUS}1.2 kg since Aug 25`,
    'a real drop keeps its minus, its figure, its unit and its day');
  eq(deltaLabel(1.2, { since: 'Aug 25', unit: 'kg' }), '+1.2 kg since Aug 25',
    'a real gain keeps its plus');
  eq(MINUS, '−', 'the sign is U+2212 MINUS and not a hyphen');
  eq(deltaArrow(-1.2), '▼', 'a drop points down');
  eq(deltaArrow(1.2), '▲', 'a gain points up');
}

/* ── ROUNDED TO ZERO ──────────────────────────────────────────────────────
 *
 * The figure says nothing moved and the sign says something did. This is the
 * signed zero one step later, and it is the commoner form in pounds: the app's
 * weightDeltaIn rounds a difference to whole pounds, so a real 0.2 kg gain
 * arrives here as 0 and must not be printed as "+0 lb".
 */
{
  eq(deltaLabel(0.04, { since: 'Aug 25', unit: 'kg' }), 'No change since Aug 25',
    'a change too small to print is reported as no change, not as +0.0 kg');
  eq(deltaLabel(-0.04, { since: 'Aug 25', unit: 'kg' }), 'No change since Aug 25',
    'and the same on the other side of zero');
  eq(deltaMoved(0.04), false, 'a raw 0.04 did not move as far as the reader is concerned');
  eq(deltaSign(-0.04), '', 'and it gets no minus');

  // Rounding is by magnitude, so the two sides of zero round the same distance.
  // A movement that reads as nothing in one direction and something in the
  // other is a bias with a sign on it.
  eq(deltaFigure(0.05), 0.1, 'a positive half-tenth rounds out to a tenth');
  eq(deltaFigure(-0.05), -0.1, 'and so does the negative one — symmetrically');
  eq(deltaLabel(0.05, { since: null, unit: 'kg' }), '+0.1 kg', 'which prints as a tenth');
  eq(deltaLabel(-0.05, { since: null, unit: 'kg' }), `${MINUS}0.1 kg`, 'on both sides');

  // Precision is the caller's, and "did it move" is judged at that precision
  // and no other. At whole units a fifth of one is nothing.
  eq(deltaLabel(0.2, { since: 'Aug 25', unit: 'lb', decimals: 0 }), 'No change since Aug 25',
    'a fifth of a pound is not a pound, and is not "+0 lb"');
  eq(deltaLabel(0.6, { since: 'Aug 25', unit: 'lb', decimals: 0 }), '+1 lb since Aug 25',
    'while a real pound survives the same rounding');

  // The printed figure is written the way a person writes it.
  eq(deltaMagnitude(2), '2', 'two, not 2.0');
  eq(deltaMagnitude(-2.5), '2.5', 'and the magnitude carries no sign of its own');
}

/* ── NO BASELINE ──────────────────────────────────────────────────────────
 *
 * "+2 kg" against what, and since when. Where a baseline exists the line names
 * the day it is measured FROM rather than saying "your previous scan" and
 * hoping; where none exists the line says so in words.
 */
{
  eq(deltaLabel(null, { since: 'Aug 25' }), 'No earlier reading',
    'nothing to measure against is stated, not printed as a zero');
  eq(deltaLabel(undefined, { since: null }), 'No earlier reading',
    'and the same when the caller has nothing at all');
  eq(deltaLabel(null, { since: 'Aug 25', noBaseline: 'First reading' }), 'First reading',
    'the wording is the screen’s to choose');
  eq(deltaFigure(null), null, 'and there is no figure behind it');

  // The day travels with the figure, in one string, so a screen cannot print
  // the movement and drop the baseline.
  ok(deltaLabel(-1.2, { since: 'Aug 25', unit: 'kg' }).endsWith('since Aug 25'),
    'the day it is measured from is part of the line, not a separate hope');
  eq(deltaLabel(-1.2, { since: null, unit: 'kg' }), `${MINUS}1.2 kg`,
    'a site that names no baseline says so by passing null, and gets no dangling "since"');
}

/* ── UNREADABLE ───────────────────────────────────────────────────────────
 *
 * A percentage of nothing. (a - b) / b is Infinity at b = 0 and NaN at 0/0.
 * fig() in src/ui/kit.tsx catches both at render, but a sentence built by
 * string interpolation never reaches fig() and prints them.
 */
{
  eq(deltaLabel(Infinity, { since: 'last month', unit: '%' }), 'No earlier reading',
    'Infinity is not a movement of Infinity percent');
  eq(deltaLabel(-Infinity, { since: 'last month', unit: '%' }), 'No earlier reading',
    'nor is negative Infinity');
  eq(deltaLabel(NaN, { since: 'last month', unit: '%' }), 'No earlier reading',
    'and NaN is not a movement at all');
  eq(deltaSign(NaN), '', 'nothing unreadable gets a sign');
  eq(deltaMoved(Infinity), false, 'nor counts as having moved');

  eq(pctChange(120, 0), null, 'a percentage of a zero baseline is null, never Infinity');
  eq(pctChange(0, 0), null, 'and 0/0 is null, never NaN');
  eq(pctChange(120, null), null, 'an unread baseline is null');
  eq(pctChange(null, 100), null, 'and so is an unread present');
  eq(pctChange(Infinity, 100), null, 'an unreadable present does not become a percentage');
  eq(pctChange(120, 100), 20, 'a real ratio is a real percentage');
  eq(pctChange(80, 100), -20, 'downwards too');

  // And the two compose: a null percentage says so rather than being signed.
  eq(deltaLabel(pctChange(120, 0), { since: 'last month', unit: '%', noBaseline: 'No prior month' }),
    'No prior month', 'a gym’s first month has no previous month, and the line says so');
}

/* ── DIRECTION ────────────────────────────────────────────────────────────
 *
 * Losing weight is progress for one member and a problem for another. The only
 * thing that decides it is the member's own goal, and where the goal does not
 * decide it the answer is undefined rather than false — "not progress" and "we
 * do not know" are different things to say to somebody about their own body.
 */
{
  eq(goalWants('fatloss', 'weight'), 'down', 'Fat Loss wants the scale down');
  eq(goalWants('muscle', 'weight'), 'up', 'Build Muscle wants it up');
  eq(goalWants('tone', 'weight'), null, 'Tone is recomposition — the scale does not settle it');
  eq(goalWants(null, 'weight'), null, 'and with no goal recorded, nothing is claimed');
  eq(goalWants('muscle', 'muscle'), 'up', 'nobody’s goal is less muscle');
  eq(goalWants('tone', 'muscle'), 'up', 'under any goal');
  eq(goalWants('fatloss', 'bodyFat'), 'down', 'Fat Loss wants body fat down');
  eq(goalWants('tone', 'bodyFat'), 'down', 'so does Tone');
  eq(goalWants('muscle', 'bodyFat'), null, 'a deliberate bulk expects some, and is not scolded for it');
  eq(goalWants('fatloss', 'girth'), 'down', 'a tape measurement follows the fat');
  eq(goalWants('muscle', 'girth'), null, 'except during a bulk');

  eq(movementIsProgress(-1.2, 'fatloss', 'weight'), true, 'a kilo off is progress for Fat Loss');
  eq(movementIsProgress(1.2, 'fatloss', 'weight'), false, 'a kilo on is not');
  eq(movementIsProgress(1.2, 'muscle', 'weight'), true,
    'and the same kilo on IS progress for somebody building muscle — the app must not congratulate them backwards');
  eq(movementIsProgress(-1.2, 'muscle', 'weight'), false, 'while a kilo off is not');
  eq(movementIsProgress(1.2, 'tone', 'weight'), undefined, 'Tone gets a neutral mark, not a verdict');
  eq(movementIsProgress(1.2, null, 'weight'), undefined, 'and so does a member with no goal set');

  // Nothing moved is not progress and not failure. It is nothing.
  eq(movementIsProgress(0, 'fatloss', 'weight'), undefined, 'an unchanged weight earns no verdict');
  eq(movementIsProgress(0.04, 'fatloss', 'weight'), undefined,
    'and neither does a change too small to print — judged at the same precision it is shown at');
  eq(movementIsProgress(null, 'fatloss', 'weight'), undefined, 'nor does an unread one');
  eq(movementIsProgress(NaN, 'fatloss', 'weight'), undefined, 'nor an unreadable one');
}

/* ── THE UNIT ─────────────────────────────────────────────────────────────
 *
 * A percentage butts against its digits and a kilogram takes a space, because
 * that is how the rest of the app already writes them.
 */
{
  eq(deltaLabel(-2, { since: null, unit: '%' }), `${MINUS}2%`, 'a percentage joins');
  eq(deltaLabel(-2, { since: null, unit: 'kg' }), `${MINUS}2 kg`, 'a kilogram takes a space');
  eq(deltaLabel(-2, { since: null, unit: '/wk' }), `${MINUS}2/wk`, 'a rate joins');
  eq(deltaLabel(-2, { since: null }), `${MINUS}2`, 'and no unit adds nothing');
  eq(deltaLabel(3, { since: 'Aug 25', unit: 'kg', noChange: 'Same weight' }), '+3 kg since Aug 25',
    'the no-change wording does not leak into a line that did change');
  eq(deltaLabel(0, { since: 'Aug 25', unit: 'kg', noChange: 'Same weight' }), 'Same weight since Aug 25',
    'and is used when it did not');
}

if (errors.length) {
  console.error(`deltaLabel: ${errors.length} failure(s)\n`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('deltaLabel ok — a movement that did not happen carries no sign, and names the day it is measured from');
