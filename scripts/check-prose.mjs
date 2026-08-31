// A dash is an answer in a slot and a hole in a sentence.
//
// The client Progress screen rendered this, under the photo-privacy heading:
//
//     — cannot see any of your photos. Press and hold one to send it…
//
// A sentence that has lost its first word. The source was
// `{fig(coach.name)} cannot see any of your photos.` and `fig()` had done
// exactly what it exists to do: a coach name that could not be read became an
// em dash. Under a label, above a KPI, that dash is the right answer and every
// reader understands it — "not measured". As the SUBJECT of a sentence it is
// not an answer at all. It reads as the screen having broken, which is the one
// thing this app spends its whole design budget on not doing.
//
// The fix is never "print something": `app/(client)/scans.tsx` names the coach
// or says "Your coach", which is a description rather than a name and is true
// whatever the missing value was. Elsewhere the sentence is rewritten so the
// unknown is not its subject, or withheld entirely because without that value
// it says nothing worth saying.
//
// ── What it looks for ─────────────────────────────────────────────────────
//
// One shape: something that can render an em dash where a value goes — a
// `fig()` call, or a `?? '—'` / `|| '—'` / `: '—'` fallback — sitting in the
// same text node as RUNNING PROSE. Prose is three words in a row. That
// threshold is the whole discrimination: "12 kg", "min", "% turned up" and
// "Best set — × 5" are slots with a unit or a short label beside them and are
// not matched; "cannot see any of your photos" is.
//
// ── What it CANNOT see, and you should not read it as claiming ────────────
//
// Slot or sentence is a judgement about meaning, and no regex makes it. This
// check makes one narrower judgement — is there running prose in the same text
// node — and everything below is outside it:
//
//   · It cannot tell a guarded site from an unguarded one. Most of KNOWN below
//     is exactly that: a `fig()` wrapping a value that the branch above it has
//     already proved is a number. Those sites are correct and stay listed,
//     because the check cannot see the guard and a reader of this file should
//     not have to guess which ones were looked at.
//
//   · It cannot see a value that renders as NOTHING rather than as a dash. An
//     empty-string name gives " has sent you a message"; a null returned into
//     JSX renders as nothing at all and closes the gap silently. Two of the
//     defects this check was written alongside were that shape — in
//     `app/(client)/account.tsx`, where `fig('')` is the empty string, and in
//     `studio-web/app/close/page.tsx`, where `money()` returns null at a gym
//     with no currency set. Neither would have been caught here. They are worse
//     than the dash, because a hole in a line looks like a rendering fault
//     rather than like missing data.
//
//   · It cannot see across lines. A sentence assembled from a variable built
//     three lines up, or wrapped by the formatter between the prose and the
//     interpolation, passes.
//
//   · It says nothing about whether a substitute is TRUE. "Your coach" is safe
//     on a screen that has already established there is one; "Someone" usually
//     is not. That is a judgement about the screen, and it is held by review.
//
// So this check holds one corner of the problem completely and is silent about
// the rest of it. Saying which corner is the point — a check that implied it
// covered the family would be worse than no check at all.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src/ui', 'src/lib', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * Something that can put an em dash where a value belongs.
 *
 * `fig()` is the app's own one; the three fallbacks are the same decision
 * written out by hand. A bare '—' typed into prose is NOT matched: that is
 * punctuation, and this app's copy is full of it.
 */
const DASHES = /fig\(|\?\?\s*['"]—['"]|\|\|\s*['"]—['"]|:\s*['"]—['"]/;

/**
 * Running prose: three words in a row, allowing the punctuation that sits
 * inside a sentence. Two words would match "turned up" and "body fat", which
 * are units and labels beside a figure; four would miss "on your last best".
 */
const SENTENCE = /[A-Za-z]{2,}[ ,'’-]+[A-Za-z]{2,}[ ,'’-]+[A-Za-z]{2,}/;

/**
 * Sites where a dash producer genuinely sits beside prose and is right to, with
 * the count that exists and the reason. A count that grows is a new offence; a
 * count that shrinks or empties is reported too, so the list cannot quietly
 * stop describing the tree — the same contract as KNOWN in check-deltas.mjs.
 *
 * Nearly all of these are the first limitation in the header: a `fig()` around
 * a value a branch above has already proved finite. They are listed rather than
 * exempted silently because "I checked this one" is worth writing down.
 */
const KNOWN = new Map([
  ['app/(client)/activity.tsx', { count: 1, why:
    'The weekly check-in row on the timeline: "82 kg · Energy 4/5 · Sleep 3/5". A check-in ' +
    'carries no weight when nobody stepped on the scales, and the dash there is the first ' +
    'field of a value strip rather than the subject of anything.' }],
  ['app/(client)/history.tsx', { count: 3, why:
    'Three sites, all fed by values that cannot be null. `life.days` is a Set size from ' +
    'lifetimeTotals() in src/lib/longView.ts — a count, never absent — and it appears once in a ' +
    'sentence and once in a KPI delta. The third is `weightDeltaIn(m.est1RM - m.prev, wu)` ' +
    'inside a `m.prev != null` arm, where both ends are finite numbers.' }],
  ['app/(client)/report.tsx', { count: 1, why:
    'The waist fact line handed to the summariser, inside `waistDShown != null && mLatest` — ' +
    'so there is a tape reading and `lengthLabel` has one to format.' }],
  ['app/(client)/tools.tsx', { count: 2, why:
    'The two per-kilogram target lines, both inside `m ?`. liftingMacros() returns null unless ' +
    'the client has both a bodyweight and a body-fat reading, so lean mass and bodyweight are ' +
    'numbers wherever these render.' }],
  ['app/(client)/workouts.tsx', { count: 1, why:
    'The new-PR message. `wkg` is the weight just logged on the set that beat the record, and ' +
    'the branch requires an estimated 1RM greater than zero, so there is a load to name.' }],
  ['app/(owner)/class-analytics.tsx', { count: 3, why:
    'Three arms of the payroll hero note, each ending "· —% turned up". The dash is a ' +
    'percentage in a dot-separated strip of figures beside its own unit, not a word in a ' +
    'sentence — the sentences in that note are the clauses after it, and they are literal.' }],
  ['app/(trainer)/analytics.tsx', { count: 2, why:
    'Both inside `gymCur ?` arms with the amount already proved non-null, so `priced()` has ' +
    'both halves it needs. The unguarded sibling of these two — the revenue-target line, where ' +
    'a gym with no currency put a dash where the amount goes — is why this check exists and it ' +
    'now branches on the currency instead.' }],
  ['app/(trainer)/client-goals.tsx', { count: 2, why:
    'The two progress notes, "58% of the way · 4 kg to go · now 82 kg". goalDelta() and ' +
    'goalValue() take numbers out of a progress object the branch above has already built, and ' +
    'the line is a strip of figures with their units.' }],
  ['src/lib/codeReturn.ts', { count: 2, why:
    'The two arms of returnLine(). Both read `r.net`, whose currency came through asMoney(), ' +
    'which refuses a null or blank one — so money() has a currency and cannot return null here. ' +
    'The `?? \'—\'` is a guard on a state the type has already ruled out.' }],
]);

/** `prose-ok: <why>` on this line or the one above it. The reason is the point
 *  of the marker, so a bare marker with nothing after it does not count. */
function excused(lines, i) {
  const near = [lines[i], i > 0 ? lines[i - 1] : ''].join('\n');
  return /prose-ok:\s*\S/.test(near);
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

/**
 * The template literals on a line, split into their literal chunks and the
 * expressions between them. A chunk is what a reader actually sees around the
 * value, which is the only thing this check reasons about.
 */
function templateHits(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    const re = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    const parts = [];
    let mm, last = 0;
    while ((mm = re.exec(body))) {
      parts.push({ before: body.slice(last, mm.index), expr: mm[1], at: mm.index, end: re.lastIndex });
      last = re.lastIndex;
    }
    parts.forEach((p, i) => {
      p.after = i + 1 < parts.length ? body.slice(p.end, parts[i + 1].at) : body.slice(p.end);
    });
    for (const p of parts) {
      if (!DASHES.test(p.expr)) continue;
      if (SENTENCE.test(p.before) || SENTENCE.test(p.after)) {
        found.push(`…${p.before.slice(-34)}[${p.expr.trim().slice(0, 30)}]${p.after.slice(0, 34)}…`);
      }
    }
  }
  return found;
}

/**
 * A `{…}` in JSX with prose beside it on the same line.
 *
 * The text before the brace is taken from after the last `>` and the text after
 * it up to the first `<`, so an attribute value or a tag name is not read as
 * the sentence. A brace that follows `=`, `,`, `:` or `(` is a prop or an
 * argument rather than a child, and is skipped.
 */
function jsxHits(line) {
  const found = [];
  const re = /\{([^{}]*(?:\([^()]*\)[^{}]*)*)\}/g;
  let m;
  while ((m = re.exec(line))) {
    if (!DASHES.test(m[1])) continue;
    const before = line.slice(0, m.index);
    if (/[=,:(]\s*$/.test(before.trim())) continue;
    const beforeText = before.replace(/.*>/s, '');
    const afterText = line.slice(re.lastIndex).replace(/<.*/s, '');
    if (SENTENCE.test(beforeText) || SENTENCE.test(afterText)) {
      found.push(`…${beforeText.slice(-34)}[${m[1].trim().slice(0, 30)}]${afterText.slice(0, 34)}…`);
    }
  }
  return found;
}

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    // Tests are excluded: a test that asserts the wrong wording quotes it.
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
  // fig() is defined here and its own doc comment quotes what it replaces.
  if (rel === 'src/ui/kit.tsx') continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const commented = commentedLines(lines);
  lines.forEach((line, i) => {
    if (commented[i] || excused(lines, i)) return;
    if (!DASHES.test(line)) return;
    const where = [...templateHits(line), ...jsxHits(line)];
    if (where.length) findings.push({ key: rel, where: `${rel}:${i + 1}`, what: where[0] });
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
    console.error(`${fresh.length} dash${fresh.length === 1 ? '' : 'es'} standing inside a sentence:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}`);
      console.error(`    ${f.what}`);
    }
    console.error('\nA dash under a label means "not measured" and every reader knows it. In a');
    console.error('sentence it is a word that has gone missing, and the line reads as broken.');
    console.error('Three ways out, and the right one depends on the site: name what is actually');
    console.error('known ("Your coach", "this client", "the gym") where that is true whatever the');
    console.error('missing value was; rewrite so the unknown is not the subject; or withhold the');
    console.error('sentence, because without that value it says nothing worth saying. The worked');
    console.error('example is coachSubject() in app/(client)/scans.tsx.');
    console.error('If the line genuinely is a slot, mark it `prose-ok: <why>` in a sentence.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-prose.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have gone. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-prose.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(`check:prose — ${files.length} files, no dash inside a sentence (${open} known slot${open === 1 ? '' : 's'} beside prose).`);
