#!/usr/bin/env node
// Three copies of Stripe's currency lists, and only two of them were compared.
//
// ── why there are copies at all ───────────────────────────────────────────
//
// Not carelessness — architecture. The Deno edge functions resolve relative
// paths with explicit extensions, so a module a function imports must be a LEAF
// with no relative imports of its own, and scripts/check-functions.mjs enforces
// exactly that. `coachMoney.ts` imports `./locale`, so no edge function can read
// it, and a shared module cannot import another shared module to fix this. The
// copy is forced.
//
// What is NOT forced is leaving a copy unchecked. adMatch.ts says this out loud:
//
//   "What stops the copies drifting is not discipline, it is an assertion:
//    adMatch.test.ts imports `currencyDecimals` from coachMoney and this file's
//    `adCurrencyDecimals` and requires the two to agree on every currency in
//    both sets. A copy nothing compares is a copy that has already drifted."
//
// It was right, and it was describing two files out of three.
//
// ── the copy nobody compared ──────────────────────────────────────────────
//
// supabase/functions/owner-metrics/index.ts carries the same two sets and says
// it is a deliberate copy. Nothing asserted it. adMatch.test.ts cannot: that
// file is Deno, importing Deno globals, and a node test cannot load it.
//
// So the failure had a clear shape. Somebody adds the seventeenth zero-decimal
// currency to coachMoney.ts. adMatch.test.ts fails until adMatch.ts is updated
// too, which is the system working. owner-metrics is not mentioned by any
// failing test, and keeps the sixteen. It then divides that gym's takings by a
// hundred for a currency that has no minor unit — on the owner's own metrics,
// where the number looks plausible and no other screen disagrees, because every
// other screen is reading the list that was updated.
//
// A gate rather than a test, because the thing to read is Deno source.
// Generalised past the three known copies on purpose: a fourth added tomorrow
// is caught the day it appears, not the day it drifts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];

// coachMoney.ts is the original. Everything else is measured against it.
const TRUTH = 'src/lib/coachMoney.ts';

/** The members of a `new Set([...])` literal assigned to `name`, or null. */
function setLiteral(src, name) {
  const m = new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
}

const truthSrc = readFileSync(TRUTH, 'utf8');
const truth = { ZERO_DECIMAL: setLiteral(truthSrc, 'ZERO_DECIMAL'), THREE_DECIMAL: setLiteral(truthSrc, 'THREE_DECIMAL') };

for (const k of ['ZERO_DECIMAL', 'THREE_DECIMAL']) {
  if (!truth[k]) errors.push(`${k} could not be read out of ${TRUTH}. This gate measures every other copy against that one, so it cannot run — which is worse than a drifted copy, because it fails open.`);
}

// Walk the tree for anything holding one of these lists.
// Compiled output is not a copy anybody maintains — counting it would let a
// stale build artifact fail this gate, or pad the tally so a real missing copy
// reads as present. `$S` is a directory an unexpanded shell variable created;
// it holds 778 compiled mirrors of src/lib and is on this list for the same
// reason .tmp is.
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', '.next', 'ios', 'android', '.claude', '.tmp', '$S']);
const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(e)) files.push(p);   // sources only; never compiled .js
  }
})('.');

const copies = [];
for (const f of files) {
  const rel = f.replace(/^\.\//, '');
  if (rel === TRUTH) continue;
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  if (!src.includes("'bif'") && !src.includes("'bhd'")) continue;
  const zero = setLiteral(src, 'ZERO_DECIMAL');
  const three = setLiteral(src, 'THREE_DECIMAL');
  if (!zero && !three) continue;               // mentions a code in prose only
  copies.push({ rel, zero, three });
}

for (const c of copies) {
  for (const [k, got] of [['ZERO_DECIMAL', c.zero], ['THREE_DECIMAL', c.three]]) {
    if (!got || !truth[k]) continue;
    if (got.join(',') !== truth[k].join(',')) {
      const missing = truth[k].filter((x) => !got.includes(x));
      const extra = got.filter((x) => !truth[k].includes(x));
      errors.push(
        `${c.rel} has a copy of ${k} that no longer matches ${TRUTH}.\n` +
        (missing.length ? `      missing: ${missing.join(', ')}\n` : '') +
        (extra.length ? `      extra:   ${extra.join(', ')}\n` : '') +
        `      This is money. A currency in one list and not the other is an amount divided by\n` +
        `      the wrong power of ten on whichever screen reads the stale copy — plausible-looking,\n` +
        `      and contradicted by no other screen, because every other screen reads the list that\n` +
        `      was updated.`);
    }
  }
}

// A copy is allowed to exist — check-functions.mjs forces some of them — but it
// has to be a copy this gate can see. One written in a shape the parser misses
// is worse than one that has drifted, because it reports as clean.
if (!errors.length && copies.length === 0) {
  errors.push(`no copies of the currency lists were found outside ${TRUTH}. There were three; if they have genuinely been consolidated, delete this gate. If they have not, its parser has gone stale and it is passing on nothing.`);
}

if (errors.length) {
  console.error(`\ncheck-currency-copies — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  • ${e}\n`);
  console.error('The copies are forced by the edge functions: a module Deno imports must be a leaf,');
  console.error('and coachMoney.ts imports ./locale. What is not forced is leaving one uncompared.\n');
  process.exit(1);
}

console.log(`check-currency-copies — ok, ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} agree with ${TRUTH}`);
