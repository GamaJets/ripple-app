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
//
// ── AND IT WAS WATCHING THE WRONG HALF ────────────────────────────────────
//
// Everything above is about the two SET LITERALS, and that is all this gate
// compared. The sets had not drifted. The GUARD had — the two lines before the
// sets are ever consulted, which decide whether this string is a currency at
// all:
//
//   coachMoney.ts   if (!/^[a-z]{3}$/.test(cur)) return null;   the rule of record
//   adMatch.ts      if (!cur) return null;                      only the empty string
//   owner-metrics   if (!c) return null;                        only the empty string
//
// So 'pounds', 'GB' and '£' were null in one copy and two-place in the other
// two, and both green: this gate compared sets that agreed, and
// adMatch.test.ts's parity loop held twenty-seven currency CODES and no
// non-code, which is the one input class where a truthiness guard and a shape
// test cannot possibly differ. Two mechanisms, both passing, over a real
// divergence in money. The guard is now compared too.
//
// ── WHAT THIS GATE COMPARES, EXACTLY ──────────────────────────────────────
//
// Per copy, for the block of lines running from the currency-normalisation
// assignment down to the first `ZERO_DECIMAL.has(...)`:
//
//   1. the normalisation NORMALISES: one `const <v> = ….trim().toLowerCase()`,
//      spelled as one of the four forms in NORMALISE_SHAPES below;
//   2. the guard's REGEX SOURCE is character-identical to the truth's — the
//      literal `^[a-z]{3}$` is compared as text, so a copy that relaxed it to
//      `^[a-z]{2,3}$` fails even though both "have a regex";
//   3. the guard's test is NEGATED and its consequent is `return null` — a copy
//      that answers 2 where the truth answers null fails;
//   4. the block contains no bare truthiness guard (`if (!v) return …`), which
//      is the exact half-rule this gate missed for as long as it existed;
//   5. the guard comes BEFORE the first set lookup. That is structural: the
//      block is defined as ending there, so a guard placed after the lookups is
//      not in the block and reports as missing.
//
// ── WHAT A STATIC COMPARISON OF HAND-COPIED FUNCTIONS CANNOT SEE ──────────
//
// Stated plainly, because a gate that overclaims is worse than one that states
// its limits — the sets were "checked" for months and the money was still wrong.
//
//   • It does not run anything. Nothing here proves the three functions return
//     the same value for any input. adMatch.test.ts does that for two of them,
//     by calling both; no node test can call the third, because it is Deno.
//   • It compares the GUARD, not the ANSWER. `majorUnits` in owner-metrics
//     divides — /1000, /100, none — and `adCurrencyDecimals` returns 3/2/0.
//     Those bodies are different arithmetic on purpose and are not compared, so
//     a copy that divided a three-decimal currency by a hundred would pass this
//     gate. check:hundreds and check:decimals are the gates aimed at that.
//   • It does not know the guard is applied to the right value. It checks that
//     the declared variable is the one tested; it cannot tell that the variable
//     was derived from the row's own currency rather than from some other field.
//   • The four accepted normalisation spellings are asserted to be equivalent
//     BY THIS COMMENT, not proved. `(c || '')` and `String(c ?? '')` differ on a
//     non-string falsy input; both currency parameters are typed `string | null
//     | undefined`, where they agree. A fifth spelling is a gate failure rather
//     than a silent pass, which is the right way round.
//   • It only sees a copy that carries BOTH set literals in a `new Set([...])`
//     a regex can read. A copy that built its set another way, or that lives in
//     SQL, or in the compiled output this walk deliberately skips, is invisible
//     — and the `copies.length === 0` check at the bottom is the only thing
//     standing between a stale parser and a gate that passes on nothing.
//   • It cannot see a copy it is not pointed at. It walks .ts/.tsx/.mjs.
//
// A copy that cannot match exactly would be ratcheted here with its reason.
// There is no ratchet: after this pass, both copies match the truth line for
// line, and an entry added later should carry the reason it could not.
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

/* ── reading the GUARD out of a copy ───────────────────────────────────────
 *
 * The three functions have three names, three signatures and three different
 * bodies — one returns 3/2/0, one divides by 1000/100/1, one is an arrow. None
 * of that can be compared. What CAN be compared is the prologue they must share
 * to be copies of one rule at all: normalise the string, then refuse it if it
 * is not a three-letter code.
 *
 * So the unit read here is the BLOCK: from the `.trim().toLowerCase()`
 * assignment down to (not including) the first `ZERO_DECIMAL.has(...)`. That
 * boundary is deliberate — a guard placed after the set lookups is not a guard,
 * because by then the copy has already answered for a string it should have
 * refused, and defining the block this way makes that case report as a MISSING
 * guard rather than a present one.
 */

// The spellings of "empty-coalesce, trim, lowercase" this gate accepts as the
// same normalisation. Listed rather than pattern-matched loosely, so that a
// fifth spelling stops the gate and gets a human decision instead of sliding
// through. See the header: their equivalence is asserted here, not proved.
const NORMALISE_SHAPES = [
  /^\(IDENT\|\|''\)\.trim\(\)\.toLowerCase\(\)$/,
  /^\(IDENT\?\?''\)\.trim\(\)\.toLowerCase\(\)$/,
  /^String\(IDENT\|\|''\)\.trim\(\)\.toLowerCase\(\)$/,
  /^String\(IDENT\?\?''\)\.trim\(\)\.toLowerCase\(\)$/,
];

const uncomment = (line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');

/**
 * → { variable, normalise, regexSource, truthiness, lines } or { error }.
 * `normalise` is the right-hand side with whitespace stripped and the declared
 * variable's SOURCE identifier rewritten to IDENT, so two copies that named the
 * parameter differently still compare.
 */
function guardOf(src, label) {
  const all = src.split('\n');
  const end = all.findIndex((l) => /ZERO_DECIMAL\s*\.\s*has\s*\(/.test(uncomment(l)));
  if (end === -1) return { error: `${label} holds the currency sets but never looks anything up in ZERO_DECIMAL, so this gate cannot find the function that uses them. A copy in a shape the parser misses reports as clean, which is worse than a drifted one.` };

  let start = -1;
  for (let j = end - 1; j >= 0 && end - j <= 15; j--) {
    if (/\.trim\(\)\s*\.\s*toLowerCase\(\)/.test(uncomment(all[j]))) { start = j; break; }
  }
  if (start === -1) return { error: `${label} looks up ZERO_DECIMAL at line ${end + 1} with no \`.trim().toLowerCase()\` normalisation in the fifteen lines above it. Either the currency is not being normalised before it is matched — in which case 'GBP' misses every entry in both sets and takes the two-place default — or it is normalised somewhere this gate cannot see.` };

  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.+?);\s*$/.exec(uncomment(all[start]).trim());
  if (!decl) return { error: `${label}:${start + 1} normalises a currency but not into a single \`const x = …;\` this gate can name. It compares the guard against the variable the normalisation declares, so it cannot check a guard whose subject it cannot identify.` };
  const variable = decl[1];
  const rhs = decl[2].replace(/\s+/g, '');
  // Rewrite the SOURCE identifier (the parameter) to IDENT; the declared name
  // is compared separately, against the identifier the guard tests.
  const normalise = rhs.replace(/(?<![\w$.])[A-Za-z_$][\w$]*(?=\s*(?:\|\||\?\?))/, 'IDENT');

  const body = all.slice(start, end);
  let regexSource = null;
  let truthiness = null;
  for (let i = 0; i < body.length; i++) {
    const line = uncomment(body[i]).trim();
    const re = new RegExp(`^if\\s*\\(\\s*!\\s*/(.+)/\\s*\\.test\\(\\s*${variable}\\s*\\)\\s*\\)\\s*return\\s+(\\S+?)\\s*;`).exec(line);
    if (re) regexSource = { source: re[1], answer: re[2], line: start + i + 1 };
    const bare = new RegExp(`^if\\s*\\(\\s*!\\s*${variable}\\s*\\)`).exec(line);
    if (bare) truthiness = start + i + 1;
  }
  return { variable, normalise, regexSource, truthiness, at: start + 1 };
}

const truthSrc = readFileSync(TRUTH, 'utf8');
const truth = { ZERO_DECIMAL: setLiteral(truthSrc, 'ZERO_DECIMAL'), THREE_DECIMAL: setLiteral(truthSrc, 'THREE_DECIMAL') };
const truthGuard = guardOf(truthSrc, TRUTH);
if (truthGuard.error || !truthGuard.regexSource) {
  errors.push(
    `the guard could not be read out of ${TRUTH}, which is the rule every other copy is measured against, so that half of this gate cannot run — and a gate that cannot run must say so rather than pass.\n` +
    `      ${truthGuard.error || 'no negated regex test returning null was found before the first set lookup.'}`);
}

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
  copies.push({ rel, zero, three, guard: guardOf(src, rel) });
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

/* ── and now the half that was missing: the guard ──────────────────────────
 *
 * Only runs when the truth's own guard was readable. If it was not, the error
 * is already recorded above and comparing copies against nothing would turn a
 * broken gate into a green one.
 */
if (truthGuard.regexSource) {
  const want = truthGuard.regexSource.source;
  for (const c of copies) {
    const g = c.guard;
    if (g.error) { errors.push(g.error); continue; }

    if (!g.regexSource) {
      errors.push(
        `${c.rel}:${g.at} normalises the currency into \`${g.variable}\` and then goes straight to the sets: there is no ` +
        `\`if (!/${want}/.test(${g.variable})) return null;\` before the first lookup.\n` +
        (g.truthiness ? `      Line ${g.truthiness} has \`if (!${g.variable})\`, which is the HALF-RULE: it catches the empty string and nothing else.\n` : '') +
        `      ${TRUTH} refuses anything that is not a three-letter code, because the sets are consulted with a\n` +
        `      string nobody checked is a currency. Without the shape test, 'pounds', 'GB' and '£' miss both sets\n` +
        `      and take the two-place default — an amount scaled by an assumed hundred and printed as a figure.\n` +
        `      It is a SHAPE test and not an allowlist on purpose: 'zzz' is still 2, because the two sets are\n` +
        `      Stripe's own and complete, so anything else well-formed is a real currency this build has not been\n` +
        `      told about by name ('aed', 'chf', 'sek') and answering null for those would drop real money.`);
      continue;
    }

    if (g.regexSource.source !== want) {
      errors.push(
        `${c.rel}:${g.regexSource.line} guards the currency with /${g.regexSource.source}/ where ${TRUTH} uses /${want}/.\n` +
        `      Compared as TEXT, deliberately: two regexes that both "look like a code test" can disagree about\n` +
        `      what a currency is, and the disagreement is an amount on one screen and a dash on another.\n` +
        `      If the rule of record has genuinely changed, change it in ${TRUTH} and copy it here; if it has not,\n` +
        `      this copy has drifted.`);
    }

    if (g.regexSource.answer !== truthGuard.regexSource.answer) {
      errors.push(
        `${c.rel}:${g.regexSource.line} answers \`${g.regexSource.answer}\` for a string that is not a currency code, where ${TRUTH} answers \`${truthGuard.regexSource.answer}\`.\n` +
        `      Null is not zero and it is not two. "Nobody said which money this is" is a state this product has\n` +
        `      to be able to report — it is white-labelled, there is no default currency and therefore no default\n` +
        `      number of decimal places — and every caller of these functions is written to carry a null through\n` +
        `      rather than print a figure that has no unit on it.`);
    }

    if (g.truthiness) {
      errors.push(
        `${c.rel}:${g.truthiness} still carries \`if (!${g.variable})\` alongside the shape test.\n` +
        `      That is the exact half-rule this gate exists to catch. It is redundant where the shape test already\n` +
        `      refuses the empty string, and a reader cannot tell a leftover from a second rule somebody meant.`);
    }

    if (!NORMALISE_SHAPES.some((re) => re.test(g.normalise))) {
      errors.push(
        `${c.rel}:${g.at} normalises the currency as \`${g.normalise}\`, which is not one of the spellings this gate\n` +
        `      accepts as equivalent to ${TRUTH}'s. The accepted list is NORMALISE_SHAPES at the top of this file and it is\n` +
        `      short on purpose: the guard below it is compared character by character, so a normalisation that differs\n` +
        `      before the guard runs would make that comparison mean less than it looks like it means. If the new\n` +
        `      spelling really is equivalent, add it there with a reason.`);
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
  console.error('and coachMoney.ts imports ./locale. What is not forced is leaving one uncompared —');
  console.error('or comparing only the half of it that cannot go wrong.\n');
  process.exit(1);
}

console.log(
  `check-currency-copies — ok, ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} agree with ${TRUTH}: ` +
  `both set literals, and the guard (/${truthGuard.regexSource.source}/ → ${truthGuard.regexSource.answer}).`);
console.log(`  ${copies.map((c) => c.rel).join('\n  ')}`);
console.log('  Compared as text. It does not run these functions and does not compare what they return —');
console.log('  see the note at the top of this file for what that leaves uncovered.');
