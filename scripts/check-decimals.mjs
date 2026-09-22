#!/usr/bin/env node
// A field that can hold a fraction is typed on a keyboard that has a decimal
// point on it.
//
// Reported from a gym floor, mid-session: "when entering the weights you do not
// have the ability use a decimal. this needs to be fixed. ie. 16.5kg or
// 16.5lb". `keyboardType="numeric"` raises the iOS NUMBER PAD, and the number
// pad has ten digits and a backspace on it. There is no decimal point and no
// comma. A member holding a 16.5 kg dumbbell could not type what was written on
// it — not "it was awkward", could not — and the same pad was on the change
// plates, the 12.7 km run, the 16.2% body fat, the 73.5 kg weigh-in and the
// 5.5 mmol/L glucose reading. Around seventy fields carried it.
//
// A sweep fixed the seventy. This is what stops the seventy-first being added
// with the number pad on it, because nothing else in this repo can see it: the
// keyboard is a prop, the truncation happens on a phone, and there is no test
// that can raise an iOS keyboard.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
//   decimal-pad  a load, a body weight, a distance, a percentage, a tape
//                measurement, a rate, a price, a pace, a glucose reading —
//                anything whose real-world values include halves.
//   numeric      reps, sets, a count of anything, an hour of the day, a whole
//                kcal figure, a step count, an age. Correct, and it must STAY:
//                widening these would let somebody type a value the write then
//                silently rounds, which is the same defect at the other end.
//   number-pad   as numeric, where a minus sign would also be meaningless.
//
// The check enforces ONE half of that: a TextInput whose surrounding words name
// something fractional, carrying `keyboardType="numeric"`. It has nothing to
// say about the other direction — see the honesty section below.
//
// ── the second half of the same bug, which this cannot see ────────────────
//
// A decimal keyboard is useless if the reader behind it throws the fraction
// away, and swapping the keyboard CREATES that reader's problem rather than
// finding it: the moment a decimal pad appears, so does its decimal key, and on
// a German, French, Spanish or Italian phone that key is a COMMA.
// `parseFloat('16,5')` is 16. A field that sanitises with
// `replace(/[^0-9]/g, '')` first does worse and produces 165.
//
// `readNumber` in src/lib/units.ts is the house reader and takes the comma; its
// assertions are in src/lib/units.test.ts, swept over every half kilogram to
// 200 kg in both spellings. This check does NOT verify that a flagged field's
// parser uses it — that is a dataflow question, and a regex reading one element
// at a time cannot answer it.
//
// ── what this deliberately does not claim ─────────────────────────────────
//
//   · It reads NAMES, not values. A field called `load` is assumed fractional
//     and a field called `reps` is assumed whole, because a value's range is
//     not in the source text. A field whose name is itself a runtime value is
//     invisible to it: the six money boxes on app/(owner)/financials.tsx are
//     generated from a FIELDS array, so the source says `value={draft[f.key]}`
//     under `{f.label}` and there is no word to read. Turning every one of them
//     back to the number pad would not fail this check. That is measured, not
//     assumed — the sweep that wrote this reverted thirty fields one at a time
//     and it caught twenty-nine.
//
//   · It cannot follow a value anywhere. It cannot tell that a field it passed
//     is written by a `parseInt` that truncates it, that a stored 16.5 renders
//     as "17 kg", or that a controlled input re-derives its own text and drops
//     the decimal point as it is typed (which is a real defect in
//     app/(trainer)/builder.tsx — the box round-trips through `liftIn` on every
//     keystroke, so "16." comes back "16" and the point cannot be reached).
//     None of that is visible one element at a time.
//
//   · It says nothing about a TextInput with NO keyboardType at all. That
//     raises the full alphabetic keyboard, which is a different complaint
//     (a member typing a load has to find the number row) and would flag a
//     large number of name and note fields to say it.
//
//   · It cannot see a keyboard chosen at runtime —
//     `keyboardType={x ? 'numeric' : 'default'}` — or one passed down through a
//     wrapper component's prop. app/(client)/intake.tsx and
//     app/(trainer)/profile.tsx both have such a wrapper.
//
// So this holds one rule completely and is silent about four more. The rest are
// held by src/lib/units.test.ts, by the readers in src/lib (readLift,
// readNumber, readFoodEdit, parseRate, parseTyped) and by review.
//
// ── why studio-web is NOT in ROOTS, written down rather than left as a hole ──
//
// A sweep over the gates found this one "does not walk the console" and offered
// that as a gap to close. It is not one, and widening ROOTS would be the wrong
// repair: this rule is `keyboardType="numeric"` on a React Native `<TextInput>`,
// and `keyboardType` DOES NOT EXIST in the DOM. There is no such attribute on
// an `<input>`, React DOM does not forward it, and a console file could not
// fail this check however wrong its fields were. Adding `studio-web/app` here
// buys a bigger scanned-file count and nothing else — which is worse than the
// gap, because the passing line then says the console was checked.
//
// The console's equivalent is a DIFFERENT RULE and would have to be written as
// one: `inputMode` on an `<input>`, where the fractional fields want
// `inputMode="decimal"` and the whole ones `inputMode="numeric"`. Two things
// make it a smaller prize than the phone's. The stakes are lower — `inputMode`
// only HINTS a touch keyboard and restricts nothing, so a desk user with a
// physical keyboard can always type the point that the iOS number pad
// genuinely withheld. And the console already does it by hand: every money
// field on /money, /costs, /payroll, /staff, /accounting and /settings carries
// `inputMode="decimal"` today, and the counts carry `inputMode="numeric"`.
//
// So the sibling rule is worth having as a ratchet on that existing habit, and
// it is not worth pretending this file is it. What it must NOT do is take the
// FRACTIONAL word list below unchanged: `\brate\b`, `\bprice\b`, `\bfee\b`,
// `\bamount\b` and `\bcost\b` are money, and money in this console is entered
// and stored in MINOR UNITS, where the right hint depends on the currency —
// `currencyDecimals()` returns null for one nobody has set, sixteen currencies
// have no minor unit at all, and five have three. A rule that demanded
// `inputMode="decimal"` on every money box would be asking a gym in Tokyo for
// fractional yen. That is the argument that has to be settled before the
// sibling is written, and it is why this is a description and not an
// implementation.
//
// ── and why src/lib is NOT in ROOTS either, for a different reason ──────────
//
// The night check:numbers was widened to `src/lib` — because that is where the
// report prose and notification bodies are built, and it was reading none of
// them — this gate was asked the same question. The answer is no, and it is not
// the studio-web answer above.
//
// This rule is a JSX attribute on a React Native `<TextInput>` element. `walk`
// below takes `.tsx` files only, and src/lib holds 475 non-test `.ts` files and
// ZERO `.tsx` files: it is the framework-free half of this codebase, the half
// that returns sentences and conclusions to a screen and never renders one. The
// three occurrences of `<TextInput` under src/lib are all inside comments —
// units.ts explaining why `plain` may not group, because the string it produces
// goes back into a text box.
//
// So adding it here buys nothing and costs the passing line its meaning. It
// would cost more than that, in fact: `assertRootFloors` would refuse the run
// outright, because src/lib's floor is 200 files and a `.tsx`-only walk of it
// finds none. That is the guard working — a root that produces nothing is a
// claim about a tree nobody opened — and it is the clearest possible statement
// that this rule has no business there.
//
// The half of the decimal defect that DOES live in src/lib is the reader, not
// the keyboard: `readNumber` in units.ts, which takes the comma an EU decimal
// pad produces. That is asserted in src/lib/units.test.ts over every half
// kilogram to 200 kg in both spellings, which is a better instrument than a
// regex would be.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src/ui'];

/**
 * Words that name a quantity whose real values include halves.
 *
 * `kg`/`lb` are matched only as whole words or as a camelCase tail, because
 * "kg" is a substring of nothing useful but "lb" is a substring of plenty.
 */
const FRACTIONAL = new RegExp([
  'weight', 'load', 'lift', 'kilogram', 'pound', '\\bkgs?\\b', '\\blbs?\\b', 'setKg\\b', 'cxWeight',
  'distance', '\\bdist\\b', 'kilometre', 'kilometer', '\\bmiles?\\b', '\\bkm\\b',
  'percent', 'body.?fat', '\\bbf\\b', 'muscle',
  'waist', 'chest', '\\bhips?\\b', 'thigh', '\\bneck\\b', 'measurement', '\\btape\\b',
  'glucose', 'mmol',
  '\\brate\\b', '\\bprice\\b', '\\bfee\\b', '\\bamount\\b', '\\bcost\\b', 'spend', 'revenue', 'pace',
  'hours slept', 'sleep.?goal',
  // `wu` and `unit` are this app's own variables for the reader's chosen weight
  // or distance unit, and a box labelled `hint={wu}` or `placeholder={unit}` is
  // by construction a box holding one of them. Without these the plate-loader's
  // "Target total" field is invisible: every word naming what it holds is a
  // runtime value, which is the general limitation named at the top of this file.
  '\\bwu\\b', '\\bunit\\b',
].join('|'), 'i');

// There is deliberately NO list of whole-number words vetoing the above.
//
// A veto was tried first and it silenced most of the real bug. Every load box
// in this app sits inches from a reps box — "Reps" and "KG" are one row — so a
// window wide enough to find the label above a field is also wide enough to
// find the neighbouring field's, and "reps" cancelled "Load in kilograms" on
// six of the nine screens the reported defect was actually on. A check that
// passes over the bug it was written for is worse than no check.
//
// So the window is narrow instead, and a whole-number field that happens to sit
// under a fractional label IS flagged. That is the same trade check-deltas.mjs
// makes and for the same reason: the answer to a false positive is one line of
// prose saying why the figure is whole, which is worth having written down.

/**
 * Fields that match FRACTIONAL, carry the number pad, and are RIGHT to.
 *
 * A count per file with the reason it is allowed, the same contract as KNOWN in
 * check-deltas.mjs and check-currency.mjs: a count that grows is a new offence,
 * and a count that shrinks or empties is reported too, so the list cannot
 * quietly stop describing the tree. "It is fine" is not a reason; each entry
 * says what makes the value whole.
 */
const KNOWN = new Map([]);

/** `decimal-ok: <why>` on the element or the line above it. The reason IS the
 *  marker — a bare one with nothing after it does not count. */
const EXCUSE = /decimal-ok:\s*\S/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The lines of one `<TextInput …>` element, plus the two above it.
 *
 * The label a field is named by is almost never on the same line as its
 * keyboard — `<Field label="Weight" hint={wu}>` sits above, and the
 * accessibilityLabel below. TWO lines up, and not one more: three reaches the
 * previous field's label in every set-logging row in this app, and a window
 * that can see the neighbour cannot tell the two fields apart.
 */
const LOOK_BEHIND = 2;

function elements(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/<TextInput\b/.test(lines[i])) continue;
    let end = i;
    // A self-closing element ends at the first `/>`; a wrapped one at `>`.
    // Bounded so an unbalanced file cannot make this quadratic.
    while (end < lines.length && end - i < 25 && !/\/>|<\/TextInput>/.test(lines[end])) end++;
    out.push({ start: i, end: Math.min(end, lines.length - 1) });
  }
  return out;
}

const files = [];
for (const r of ROOTS) {
  try { walk(join(ROOT, r), files); } catch { /* a root not there yet */ }
}

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, for the same
// reason.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

const findings = [];
let inputs = 0;
let padded = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const { start, end } of elements(lines)) {
    inputs++;
    const el = lines.slice(start, end + 1).join('\n');
    if (/keyboardType\s*=\s*["']decimal-pad["']/.test(el)) padded++;
    if (!/keyboardType\s*=\s*["']numeric["']/.test(el)) continue;
    const context = lines.slice(Math.max(0, start - LOOK_BEHIND), end + 1).join('\n');
    if (EXCUSE.test(context)) continue;
    if (!FRACTIONAL.test(context)) continue;
    const named = (context.match(FRACTIONAL) || [''])[0];
    findings.push({
      key: rel,
      where: `${rel}:${start + 1}`,
      what: lines[start].trim().slice(0, 110),
      named,
    });
  }
}

const seen = new Map();
for (const f of findings) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);

const fresh = [];
const shrunk = [];
const stale = [];
for (const f of findings) {
  const allowed = KNOWN.get(f.key)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // The whole file is shown when it goes over its count: which of a file's
  // three is "the new one" is not knowable from the text.
  if (seen.get(f.key) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || shrunk.length || stale.length) {
  if (fresh.length) {
    console.error(`${fresh.length} fractional field${fresh.length === 1 ? '' : 's'} on a keyboard with no decimal point:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}  — named by "${f.named}"`);
      console.error(`    ${f.what}`);
    }
    console.error('\n`keyboardType="numeric"` raises the iOS number pad, which has no decimal');
    console.error('point and no comma on it. A member cannot type the 16.5 kg written on the');
    console.error('dumbbell in their hand. Use "decimal-pad".');
    console.error('\nThen follow the value: a decimal keyboard offers a COMMA on a European');
    console.error('phone, and `parseFloat(\'16,5\')` is 16 while `replace(/[^0-9]/g, \'\')` makes it');
    console.error('165. Read it with `readNumber` from src/lib/units.ts.');
    console.error('\nIf the figure genuinely is whole — a rep count, a step count, an hour of the');
    console.error('day — say so on the element as `decimal-ok: <why it cannot be a fraction>`,');
    console.error('or add the file to KNOWN in scripts/check-decimals.mjs with the same reason.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-decimals.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have gone. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-decimals.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `decimals ok — ${inputs} text fields across ${files.length} files, ${padded} on a decimal pad; ` +
  'no fractional field is left on the number pad' +
  (open ? `, bar ${open} listed site${open === 1 ? '' : 's'} in KNOWN that cannot grow.` : '.'),
);
