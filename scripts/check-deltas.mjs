// A movement is signed in one place, or it is signed wrong in twenty.
//
// The client Progress hero read "−0% since Aug 25, 2026". The expression behind
// it was `bfMove <= 0 ? '−' : '+'`, so a body-fat reading that had not moved at
// all took the minus arm — and a small drop in body fat is exactly the kind of
// small drop somebody is pleased about. There is no such thing as negative
// nothing, and the app was congratulating a member for a change that did not
// happen.
//
// It was one site of about twenty-five. Every screen that shows a movement had
// written its own sign expression, and each had to remember independently that
// zero is neither direction: some wrote `x <= 0 ? '−' : '+'`, some
// `x >= 0 ? '+' : '−'`, some `x > 0 ? '+' : '−'`. Which sign a member saw for a
// change of nothing depended on nothing but which author reached the file
// first. src/lib/deltaLabel.ts is now the one place that decides it, and this
// check is what stops the twenty-sixth being written by hand.
//
// ── What it looks for ─────────────────────────────────────────────────────
//
// A conditional on a comparison against zero, one of whose arms is a sign
// character: '+', '−' (U+2212), '▲' or '▼'. That is the defect's exact
// syntactic shape and it is the shape of nothing else — an arrow is a sign
// drawn as a triangle and carries the same claim about direction, so it is
// matched too.
//
// The rule enforced is NOT "guard your zero". It is the stronger and much
// simpler "do not hand-roll a sign at all": call deltaLabel, deltaSign or
// deltaArrow from src/lib/deltaLabel.ts. That distinction is what makes this
// check honest rather than noisy — see below.
//
// ── What it CANNOT see, and you should not read it as claiming ────────────
//
// This is a lint over source text, one line at a time. It does not resolve a
// variable, does not know a type and does not follow a value anywhere. So:
//
//   · It cannot tell a guarded site from an unguarded one. `x > 0 ? '+' : '−'`
//     inside an enclosing `x !== 0 ? … : 'No change'` is correct today, and
//     looks identical to the bug. That is precisely why the rule is "use the
//     helper" — a rule this check CAN see — rather than "have a zero arm",
//     which it cannot. A correct hand-rolled site is still flagged, and the
//     fix for it is the same as for a wrong one.
//
//   · It cannot see a sign whose comparison happened on an earlier line.
//     `const up = value >= 0` two lines up, then `up ? '▲' : '▼'`, passes. That
//     was a real defect in src/ui/charts.tsx and no regex would have found it.
//
//   · It says NOTHING about the other four members of this defect family, all
//     of which need types or meaning rather than text:
//       – a change of 0.04 kg that FORMATS as "0.0" and is then signed. Whether
//         the value tested is the value printed is a dataflow question.
//       – a delta that names no baseline. deltaLabel's `since` is a required
//         field, so TypeScript already asks this at every call; a regex could
//         only check that something was passed, not that it was the right day.
//       – a direction word or a good/bad colour on a metric whose "good"
//         depends on the member's own goal. Entirely semantic.
//       – a percentage of a zero baseline. Whether a denominator can be zero is
//         not in the source text. `pctChange` in deltaLabel.ts is the guard;
//         src/lib/deltaLabel.test.ts is what actually proves any of this.
//
// So this check enforces one rule of the five, completely. The other four are
// held by the type, by the test suite and by review — and saying so here is the
// point, because a check that implied it held all five would be worse than no
// check at all.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src/ui', 'src/lib'];

/**
 * A comparison against zero, and a sign character in one of the arms after it.
 *
 * The window between the `0` and the `?` is bounded so that two unrelated
 * expressions on one long line cannot be stitched into a match. '−' here is
 * U+2212 MINUS, which is what the app prints; a hyphen would be a different
 * character and is not what any of these sites used.
 */
const HAND_ROLLED = /[<>]=?\s*0\b[^\n]{0,90}\?[^\n]{0,60}['"`][+−▲▼]/;

/**
 * Sites that genuinely may keep a hand-rolled sign, with the count that exists
 * and the reason it is allowed to. A count that grows is a new offence; a count
 * that shrinks or empties is reported too, so the list cannot quietly stop
 * describing the tree — the same contract as KNOWN in check-currency.mjs.
 */
const KNOWN = new Map([
  ['app/(client)/scans.tsx', { count: 5, why:
    'The screen the defect was found on, and the one it was fixed on. Its five sites are the ' +
    'reference wording for the rest of the app: the hero at ~836 has an explicit `=== 0` arm ' +
    'reading "No change since <day>", the trend note at ~907 and the movement chip at ~784 ' +
    'each carry their own empty-sign arm, and the two `> 0 ? \'+\' : \'\'` forms print an ' +
    'unsigned "0" for a measured no-change rather than a signed one. Correct as written, and ' +
    'left as the worked example — but still hand-rolled, so it is listed rather than exempted ' +
    'silently.' }],
  ['app/(trainer)/dashboard.tsx', { count: 1, why:
    'Not a delta. `v > 0 ? \'+\' + v : String(v)` labels the fixed offsets on the coach\'s ' +
    'nutrition-adjustment picker — a chooser of values, where "+100" and "0" and "-100" are the ' +
    'options themselves and none of them is a movement anybody measured.' }],
  ['src/lib/photoCompare.ts', { count: 1, why:
    '`deltaText`, whose zero is deliberate and pinned by src/lib/photoCompare.test.ts: "a ' +
    'measured no-change prints as 0". It sits in a side-by-side compare column where a dash ' +
    'already means "not measured", so 0 and — are the two answers that column needs and neither ' +
    'is a sign on nothing.' }],
]);

/** `delta-ok: <why>` on this line or the one above it. The reason is the point
 *  of the marker, so a bare marker with nothing after it does not count. */
function excused(lines, i) {
  const near = [lines[i], i > 0 ? lines[i - 1] : ''].join('\n');
  return /delta-ok:\s*\S/.test(near);
}

/** Lines that are entirely comment — a header quoting the defect it prevents is
 *  not the defect. Tracks block comments across lines; a `//` line counts only
 *  when nothing but whitespace precedes it. */
function commentedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((line, i) => {
    if (inBlock) {
      out[i] = true;
      if (line.includes('*/')) inBlock = false;
      return;
    }
    if (/^\s*\/\//.test(line)) { out[i] = true; return; }
    const open = line.indexOf('/*');
    if (open !== -1 && !line.includes('*/', open)) {
      inBlock = true;
      // A JSX comment opener (`{/*`) still has code before it in general, so it
      // counts as commented only when nothing but whitespace or a brace does.
      out[i] = /^[\s{]*$/.test(line.slice(0, open));
      return;
    }
    out[i] = /^\s*[{]?\s*\/\*.*\*\/\s*[}]?\s*$/.test(line);
  });
  return out;
}

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    // Tests are excluded: src/lib/deltaLabel.test.ts asserts against the wrong
    // versions on purpose, so every one of its assertions looks like the bug.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
  }
}
for (const r of ROOTS) { try { walk(join(ROOT, r)); } catch { /* a root not there yet */ } }

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, for the same
// reason.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  // The helper itself is where the sign is decided, and its header quotes every
  // wrong form it replaces. Excluding it by path rather than by marker, because
  // there is no version of this file that should be asked to use itself.
  if (rel === 'src/lib/deltaLabel.ts') continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const commented = commentedLines(lines);
  lines.forEach((line, i) => {
    if (commented[i] || excused(lines, i)) return;
    if (!HAND_ROLLED.test(line)) return;
    findings.push({ key: rel, where: `${rel}:${i + 1}`, what: line.trim().slice(0, 120) });
  });
}

const seen = new Map();
for (const f of findings) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);

const fresh = [];
const shrunk = [];
const stale = [];
for (const f of findings) {
  const allowed = KNOWN.get(f.key)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // The whole file is shown when it goes over its count: which of a file's six
  // is "the new one" is not knowable from the text.
  if (seen.get(f.key) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || shrunk.length || stale.length) {
  if (fresh.length) {
    console.error(`${fresh.length} hand-rolled sign${fresh.length === 1 ? '' : 's'} on a movement:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}`);
      console.error(`    ${f.what}`);
    }
    console.error('\nZero is neither direction, and it is a WORD — "No change", not "−0".');
    console.error('Use deltaLabel / deltaSign / deltaArrow from src/lib/deltaLabel.ts, which has');
    console.error('an arm for nothing, an arm for nothing readable, and takes the day the movement');
    console.error('is measured FROM as a required field. This check cannot tell a guarded site from');
    console.error('an unguarded one, which is exactly why the rule is to use the helper.');
    console.error('If a line genuinely is not a movement, mark it `delta-ok: <why>` in a sentence.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-deltas.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have gone. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-deltas.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `deltas ok — ${files.length} files; every movement is signed by src/lib/deltaLabel.ts` +
  (open ? `, bar ${open} listed site${open === 1 ? '' : 's'} in KNOWN that cannot grow.` : '.'),
);
