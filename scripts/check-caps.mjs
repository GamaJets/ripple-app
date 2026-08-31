#!/usr/bin/env node
// Labels that sit next to each other are capitalised the same way.
//
// Reported twice. The second time it was four words in a row on the client's
// Weekly Report:
//
//     Energy 4/5 · sleep 3/5 · mood 4/5 · adherence 4/5
//
// directly under a row reading "Weight · Body Fat · Muscle · Waist". Nobody
// complained that "sleep" was wrong. They complained that four siblings did not
// match, one line under four that did. A sweep fixed those four; a sweep had
// already been done once and the tree drifted back. This is what holds the line.
//
// ── the house rule, and where it is already written down ──────────────────
//
// TITLE CASE for a heading, a section title, a nav row, a button, a field label
// and the label above or beside a value. Small words stay lowercase unless they
// open the string — "Look It Up on the Web", "PRs on Record", "Add a Shift".
//
//   · app/(client)/workouts.tsx, over the Go To grid: "Labels are title case
//     throughout. The row previously mixed 'This Week' with 'Scan machine' and
//     'Watch & devices', and that last one contradicted the screen's OWN title."
//   · src/lib/workoutKind.ts:35 — "Titles are Title Case and each list is
//     alphabetical. Acronyms stay upper-case."
//   · src/lib/foodSearch.ts:75 — "Short Title Case badge".
//   · src/lib/coverage.test.ts asserts it outright, minor words and all:
//     "short function words stay lowercase", and "the unit symbol is not a word
//     to capitalise" — kcal is never Kcal.
//
// SENTENCE CASE for prose: a supporting note, an empty state, an error, a
// placeholder, a warning. src/lib/releaseNotes.ts:28 — "One line, sentence
// case". This copy is deliberately written as plain sentences and
// over-capitalising it would be a worse regression than the bug, so no rule
// below looks at a note, a `note=`, a `<Notice title>` or anything longer than a
// short label.
//
// ── the trap: half of this codebase's labels have no visible case ──────────
//
// `ty.micro` in src/theme/scale.ts carries `textTransform: 'uppercase'`. Every
// string under it renders in capitals whichever way it is typed, so its source
// casing is invisible and correcting it is churn with no user-visible effect.
// That covers a LOT of ground: <SectionHead title>, <Hero label>, <Field label>,
// <Notice kicker>, <ActionCard ringLabel/ringNote>, <QuickRow> — six of the
// kit's slots. The naive version of this check flagged 122 of these and 17 real
// ones; the 122 are why nobody would have run it twice.
//
// The console has the same trap pointing the other way. The rail in
// studio-web/components/Shell.tsx renders every nav label with
// `textTransform: 'lowercase'`, and DataTable's column headers and the .micro
// and .eyebrow classes in globals.css are all `text-transform: uppercase`. So
// "Plans & payments" sitting above "Revenue" in NAV is invisible too.
//
// This check therefore works from a HAND-VERIFIED list of slots whose face is
// not transformed — read off src/ui/kit.tsx, named in VISIBLE below — rather
// than from a guess about what a string is for.
//
// ── what it looks for ─────────────────────────────────────────────────────
//
//  1. A CASE-VISIBLE KIT SLOT THAT IS NOT TITLE CASE. <Cta label>,
//     <Ghost label>, <ListRow title>, <ActionCard title|cta>. Buttons and nav
//     rows, and the tree agrees with itself about them: "Cancel" x26,
//     "Try Again" x17, "Close" x13.
//
//  2. A `·`-JOINED RUN WHOSE SEGMENTS DISAGREE. Three or more segments in one
//     string, at least two of them starting with a literal word, and those
//     words not agreeing on capitalisation. This is the reported bug, and it is
//     the one shape a static scan can be certain about: the segments are
//     siblings by construction, so no heuristic is needed to decide whether
//     they are headings or prose — they only have to match each other.
//
//  3. ONE LABEL, TWO SPELLINGS. The same short string in two casings across the
//     app, counting only case-visible positions. "Try Again" x17 and
//     "Try again" x5 were the same button; "Add Equipment" opened a sheet
//     headed "Add equipment"; "Weekly Availability" opened "Weekly availability"
//     — a name that changes as you tap it reads as two different things.
//
// ── what it cannot see, and where it will be wrong ────────────────────────
//
// It cannot tell a heading from a sentence. Nothing static can: "Not medical
// advice" and "Add a shift" are the same shape and only one of them is a
// heading. Rules 1 and 3 dodge that by looking only at slots whose PURPOSE is
// known from the component, and rule 2 dodges it by comparing siblings with
// each other instead of against a convention. So:
//
//   · A LOCAL component — `const Line = ({label}) => <Text style={ty.micro}>` in
//     app/(trainer)/client-intake.tsx — is not in VISIBLE and is not read. Its
//     labels are invisible anyway, but a local component with a VISIBLE face is
//     equally unread, and that is a miss, not a pass.
//   · A label built at runtime (`` `${group} · ${source(v)}` ``) is only seen
//     when the literal parts are on the line. A run assembled from a helper's
//     return value is not checked at all.
//   · Rule 2 needs three segments of at most two words each, and skips
//     placeholders. Two-segment runs are usually prose — "First Mon 3 Feb ·
//     latest today", "Asked 4 Jan · deleted 9 Jan"; longer segments are a
//     sentence with dots for commas — "Your session fee · notices to members ·
//     support · gym activity", where only the first is capitalised because it
//     opens the string, and that is right. Both limits are judgements. A real
//     mismatch across three long segments is a miss.
//   · A quiet inline affordance — small, unweighted, on t.ink3, beside the
//     thing it acts on: "change", "clear", "hide", "or" — is a third register
//     and is written lower case on purpose. Rule 3 skips it rather than
//     matching it against the Ghost buttons that share its words.
//   · A word after a hyphen is left alone. The tree writes both "Heart-rate
//     Zones" and "Month-End Close" and neither is wrong enough to legislate.
//   · Owning-component detection is a backward scan for the nearest `<Capital`,
//     which a JSX element nested inside an attribute would fool. There is none
//     of that in these slots today; if one appears, this reads the wrong
//     component and the failure mode is a miss.
//
// Nothing here is a spell-checker for prose, and it must not become one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
// Rules 1 and 3 are about src/ui/kit.tsx's slots and the faces they render in,
// so they run over the three app groups and the shared kit. The console is a
// different surface with its own uniform voice — every <button> in it reads
// "Add plan", "Take a visit", "Back in service" — and holding it to the app's
// button convention would be a rewrite, not a fix. Rule 2 runs everywhere,
// because a run of mismatched siblings is wrong in any voice.
const APP_ROOTS = ['app', 'src/ui'];
const ALL_ROOTS = [...APP_ROOTS, 'studio-web/app', 'studio-web/components'];

/**
 * Slots whose face is NOT transformed, read off src/ui/kit.tsx line by line.
 * Adding a component here is a claim that its text renders as typed.
 */
const VISIBLE = new Map([
  ['Cta', ['label']],            // ty.label — kit.tsx:427
  ['Ghost', ['label']],          // ty.label — kit.tsx:526
  ['ListRow', ['title']],        // ty.body  — kit.tsx:401
  ['ActionCard', ['title', 'cta']], // ty.body kit.tsx:380, and cta is a <Cta>
]);

/**
 * Slots that render under `ty.micro` and are therefore uppercased whatever the
 * source says. Listed so the reason is written down rather than inferred from
 * their absence above.
 */
const MICRO = new Map([
  ['SectionHead', ['title']],    // kit.tsx:87
  ['Hero', ['label']],           // kit.tsx:143
  ['Field', ['label']],          // kit.tsx:491
  ['Notice', ['kicker']],        // kit.tsx:850
  ['ActionCard', ['ringLabel', 'ringNote']], // kit.tsx:369, 373
]);

// <Notice title> is ty.head and IS case-visible, but it is deliberately a
// sentence everywhere it is used — "Your clients could not be read" x12, "We
// couldn't read your training log" x7 — so it is prose and rule 1 leaves it
// alone. It is not in MICRO because the reason is different, and a reader
// should not be told it is uppercased when it is not.

/** Genuinely lowercase, or fixed-case, and never a word to capitalise. */
const ALLOW = new Set([
  // units and symbols — src/lib/coverage.test.ts: "the unit symbol is not a
  // word to capitalise"
  'kcal', 'kg', 'lb', 'lbs', 'g', 'mg', 'ml', 'cm', 'mm', 'km', 'mi', 'min', 'mins',
  'hr', 'hrs', 'bpm', 'mmol/l', 'mmol', 'w', 'reps', 'sets', 'rpe', 'm',
  // brands, spelled the way their owners spell them
  'whoop', 'iphone', 'ipad', 'apple', 'watch', 'tiktok', 'repdb', 'inbody',
  'spotify', 'fitbit', 'garmin', 'oura', 'stripe', 'repple',
]);

/** Short words that stay lowercase inside a title, unless they open it. */
const MINOR = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'with', 'per',
  'at', 'by', 'from', 'as', 'vs', 'into', 'nor', 'but', 'so', 'if',
]);

/**
 * Real, unfixed, and each with the edit it needs — counted, so the list can
 * shrink and can never grow. Same ratchet as scripts/check-currency.mjs: a file
 * listed at 2 passes at 2 and fails at 3, and a count that has dropped fails
 * too, asking for the number to come down with the work.
 */
const KNOWN = new Map([
  // Two real mismatches this check CANNOT see, recorded here rather than as
  // entries, because an entry with a count of zero fails as a stale exception
  // and an entry that never matches teaches a reader to distrust the list:
  //
  //   · app/(trainer)/client-report.tsx:426 — `<Row label="Days trained">`
  //     against "Days Trained" on the three screens showing the same figure.
  //     `Row` is a local component, and rule 3 reads only the kit's slots and
  //     bare <Text>. Left as it is on purpose either way: that Row sits in a
  //     set of its own siblings — "Of those, with no outcome recorded",
  //     "Body-composition scans", "Days with tape measurements" — which are
  //     uniformly sentence case, and it mirrors the PDF table in
  //     src/lib/clientReport.ts whose exact string clientReport.test.ts
  //     asserts. Fixing the screen alone breaks the agreement that matters
  //     more, between the screen and the document it previews.
  //   · app/(trainer)/dashboard.tsx:478 — `label: 'Your main code'` against
  //     the <SheetHead title="Your Main Code"> above it. An object literal, not
  //     an attribute, so rule 3 never reads it; and it is not a rendered
  //     heading — codeCountLine(), an accessibilityLabel and a share message
  //     all read it mid-sentence.

  ['app/(trainer)/calendar.tsx:split', { count: 2, why:
    'Two <ListRow title> entries — "Weekly Availability" and "Block Out Time" — open sheets headed ' +
    '"Weekly availability" and "Block out time" in the same file, so the name changes as the coach ' +
    'taps it. The edit is four characters and belongs in that file: capitalise the two ty.head ' +
    'sheet titles at lines 1216 and 1266 to match the rows that open them. It was not made here ' +
    'because another change is in flight in app/(trainer)/calendar.tsx tonight.' }],

]);

/* ── files ────────────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === '.tmp') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const appFiles = APP_ROOTS.flatMap((r) => walk(join(ROOT, r)));
const allFiles = [...new Set(ALL_ROOTS.flatMap((r) => walk(join(ROOT, r))))];

/* ── the casing test ──────────────────────────────────────────────────────── */

/** The bare word: quotes, brackets and trailing punctuation stripped off. */
const bare = (w) => w.replace(/^[('"“‘]+/, '').replace(/[)'"”’,.:;?!…]+$/, '');

/** A word whose case is not ours to judge: a unit, a brand, an acronym, a
 *  figure, or anything with a capital already inside it (PRs, iPhone, 1RM). */
function fixedCase(w) {
  if (!w) return true;
  if (ALLOW.has(w.toLowerCase())) return true;
  if (/\d/.test(w)) return true;
  if (/[A-Z]/.test(w.slice(1))) return true;
  return false;
}

/** The words of a title that this check is willing to have an opinion about.
 *  A word after a hyphen is not one of them — see the header. */
function judged(text) {
  return text.split(/\s+/).map((w, i) => ({ i, w: bare(w) })).filter(({ w }) => w && /^[A-Za-z]/.test(w));
}

/** Every word of `text` that breaks Title Case, or [] if it holds. */
function notTitleCase(text) {
  const bad = [];
  for (const { i, w } of judged(text)) {
    if (fixedCase(w)) continue;
    if (!/^[a-z]/.test(w)) continue;
    if (i > 0 && MINOR.has(w.toLowerCase())) continue;
    bad.push(w);
  }
  return bad;
}

/* ── findings ─────────────────────────────────────────────────────────────── */

const findings = [];
function flag(file, line, kind, what, fix) {
  const rel = relative(ROOT, file);
  findings.push({ key: `${rel}:${kind}`, where: `${rel}:${line}`, what, fix });
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Which component an attribute belongs to: the nearest `<Capitalised` before
 * it. Cheap, and wrong only for JSX nested inside an attribute of the tag being
 * read — see the header.
 */
function ownerOf(src, idx) {
  const before = src.slice(Math.max(0, idx - 800), idx);
  const hits = [...before.matchAll(/<([A-Z][A-Za-z0-9]*)/g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

/** True where `idx` sits inside a `//` or `/* *​/` comment. */
function commentedAt(src, idx) {
  const lineStart = src.lastIndexOf('\n', idx - 1) + 1;
  const head = src.slice(lineStart, idx);
  if (/(^|[^:])\/\//.test(head)) return true;
  const open = src.lastIndexOf('/*', idx);
  return open >= 0 && src.indexOf('*/', open) > idx;
}

/* ── 1. a case-visible kit slot that is not Title Case ────────────────────── */

const ATTR = /\b([a-z][A-Za-z]*)\s*=\s*(?:"([^"\n]{2,60})"|\{'([^'\n]{2,60})'\})/g;

/** Every case-visible label in the app, for rules 1 and 3. */
const visibleLabels = [];   // { file, line, text, from }

for (const file of appFiles) {
  const src = readFileSync(file, 'utf8');

  for (const m of src.matchAll(ATTR)) {
    if (commentedAt(src, m.index)) continue;
    const attr = m[1];
    const text = m[2] ?? m[3];
    const owner = ownerOf(src, m.index);
    if (!owner) continue;
    if (MICRO.get(owner)?.includes(attr)) continue;
    if (!VISIBLE.get(owner)?.includes(attr)) continue;
    const line = lineOf(src, m.index);
    visibleLabels.push({ file, line, text, from: `<${owner} ${attr}>` });
    const bad = notTitleCase(text);
    if (bad.length) {
      flag(file, line, 'slot',
        `<${owner} ${attr}="${text}"> — ${bad.map((w) => `“${w}”`).join(', ')} lower-case in a label`,
        'A button and a nav row are Title Case here — "Cancel", "Try Again", "Log a Workout". '
        + 'Small words stay lowercase unless they open the string.');
    }
  }

  // A hand-rolled label: <Text style={{ ...ty.label … }}>Take Photo</Text>.
  // Only for rule 3 — rule 1 does not judge these, because a bare <Text> is
  // where the prose lives too and there is no slot name to tell them apart.
  for (const m of src.matchAll(/<Text([^>]{0,220}?)>([^<>{}\n]{2,44})<\/Text>/g)) {
    if (commentedAt(src, m.index)) continue;
    const face = (m[1].match(/ty\.(\w+)/) || [])[1];
    if (face === 'micro') continue;
    if (/textTransform/.test(m[1])) continue;
    // The quiet register, and it is deliberately lower case. A small unweighted
    // t.ink3 affordance beside something — "change" next to a picked member,
    // "clear" next to a logged set, "hide" in a SectionHead's note — is written
    // that way on purpose and reads as an aside rather than a button. Compared
    // against the Ghost buttons that share its words it produced the check's
    // only two false alarms, and capitalising it would be exactly the
    // over-correction this file is meant not to make.
    if (!/fontWeight/.test(m[1]) && /t\.ink3/.test(m[1])) continue;
    const text = m[2].trim();
    if (!/^[A-Za-z][A-Za-z '&?!/-]*$/.test(text)) continue;
    if (text.split(/\s+/).length > 5) continue;
    visibleLabels.push({ file, line: lineOf(src, m.index), text, from: '<Text>' });
  }
}

/* ── 2. a `·`-joined run whose segments disagree ──────────────────────────── */

const DOT = '·';

/**
 * Which lines are inside a comment. Rule 2 needs this and `startsWith('//')`
 * is not enough: the four lines that most look like the reported bug in this
 * tree are inside a block comment in app/(client)/workouts.tsx that DOCUMENTS
 * the Go To grid's ordering, and its continuation lines start with neither
 * `//` nor `*`. A check whose first four hits are its own house rule being
 * explained is a check people switch off.
 */
function commentedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let block = false;
  lines.forEach((line, i) => {
    if (block) { out[i] = true; if (line.includes('*/')) block = false; return; }
    const s = line.trim();
    if (s.startsWith('//')) { out[i] = true; return; }
    const open = line.indexOf('/*');
    if (open >= 0 && line.indexOf('*/', open) < 0) { out[i] = true; block = true; }
  });
  return out;
}

for (const file of allFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const commented = commentedLines(lines);
  lines.forEach((line, i) => {
    if (commented[i]) return;
    if (!line.includes(DOT)) return;
    // Read the run out of the STRING it lives in, not off the raw line: the
    // line `mk('Push · Pull · Legs', …)` splits into `mk('Push`, ` Pull`,
    // ` Legs`, and the identifier in front of the quote is not a label.
    // A placeholder is prose by the house rule, and the ones with a `·` in them
    // are examples of what to TYPE — "Flying to Berlin · refeed · away from the
    // gym", "e.g. Push · Pull · Legs". Capitalising those would be telling the
    // member their own note is a heading.
    const noPlaceholder = line.replace(/placeholder\s*=\s*(?:"[^"\n]*"|\{?'[^'\n]*'\}?)/g, ' ');
    // `>…<` must admit `{…}`: the reported bug WAS a JSX text run with an
    // interpolation in every segment — `>Energy {c.energy}/5 · Sleep
    // {c.sleep}/5 · …<` — and a pattern that stopped at the first brace could
    // not see the one line this check exists for. Verified by putting it back:
    // see the note under "proving it fails" at the foot of this file.
    for (const lit of noPlaceholder.match(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|>[^<>\n]*</g) ?? []) {
      const body = lit.slice(1, -1);
      if (!body.includes(DOT)) continue;
      // An interpolation is a value, not a word — blank it out so the
      // segment's leading LITERAL word is what gets read. `{x} · {y}` then has
      // nothing to compare and is correctly left alone.
      const blanked = body.replace(/\$\{[^}]*\}/g, ' ').replace(/\{[^}]*\}/g, ' ');
      const segs = blanked.split(DOT).map((x) => x.trim()).filter(Boolean);
      if (segs.length < 3) continue;   // two segments is nearly always prose
      // Every segment has to be short enough to be a LABEL. A run of longer
      // fragments is a sentence with dots for commas — app/(owner)/ops.tsx
      // reads "Your session fee · notices to members · support · gym activity",
      // where only the first is capitalised because it opens the string, which
      // is correct. The reported bug was "Energy 4/5 · sleep 3/5 · mood 4/5 ·
      // adherence 4/5": two words a segment, every one of them a label with its
      // own figure. Two is the line, and it is a judgement, not a fact.
      if (segs.some((seg) => seg.split(/\s+/).length > 2)) continue;
      const heads = segs
        .map((seg) => (seg.match(/^([A-Za-z][A-Za-z-]*)/) || [])[1])
        .filter((w) => w && !fixedCase(w) && !MINOR.has(w.toLowerCase()));
      if (heads.length < 2) continue;
      const upper = heads.filter((w) => /^[A-Z]/.test(w));
      if (!upper.length || upper.length === heads.length) continue;
      flag(file, i + 1, 'run',
        `a run of ${segs.length} joined by “${DOT}” whose words disagree — ${heads.map((w) => `“${w}”`).join(' ')}`,
        'These are siblings on one line. Whatever they are, they match each other — '
        + 'the reported bug was "Energy 4/5 · sleep 3/5 · mood 4/5", not a wrong word.');
    }
  });
}

/* ── 3. one label, two spellings ──────────────────────────────────────────── */

const spellings = new Map();
for (const L of visibleLabels) {
  if (L.text === L.text.toUpperCase()) continue;   // A DELIBERATE SHOUT is not a casing
  const k = L.text.toLowerCase();
  if (!spellings.has(k)) spellings.set(k, new Map());
  const forms = spellings.get(k);
  if (!forms.has(L.text)) forms.set(L.text, []);
  forms.get(L.text).push(L);
}

for (const [, forms] of spellings) {
  if (forms.size < 2) continue;
  const ranked = [...forms.entries()].sort((a, b) => b[1].length - a[1].length);
  const [winner] = ranked[0];
  for (const [text, uses] of ranked.slice(1)) {
    for (const u of uses) {
      flag(u.file, u.line, 'split',
        `“${text}” ${u.from}, spelled “${winner}” elsewhere`,
        `Pick one. ${forms.get(winner).length} place${forms.get(winner).length === 1 ? '' : 's'} say `
        + `“${winner}” — ${forms.get(winner).slice(0, 3).map((w) => `${relative(ROOT, w.file)}:${w.line}`).join(', ')}`
        + '. A name that changes as you tap it reads as two different things.');
    }
  }
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const seen = new Map();
for (const f of findings) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);

const fresh = [];
const shrunk = [];
const stale = [];

for (const f of findings) {
  const allowed = KNOWN.get(f.key)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // The whole file is shown when it goes over, not the first N — which of a
  // file's two is "the new one" is not knowable.
  if (seen.get(f.key) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || shrunk.length || stale.length) {
  if (fresh.length) {
    console.error(`${fresh.length} label${fresh.length === 1 ? '' : 's'} out of step with the ones beside it:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}`);
      console.error(`    ${f.what}`);
      console.error(`    → ${f.fix}\n`);
    }
    console.error('Title Case for a heading, a nav row, a button, a field label and the label above or');
    console.error('beside a value. Sentence case for a note, an empty state, an error and a placeholder —');
    console.error('this copy is written as plain sentences and capitalising it would be the worse bug.');
    console.error('A string under `ty.micro` is uppercased by the face and is not checked either way.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-caps.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have been fixed. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-caps.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `caps ok — ${allFiles.length} files; ${visibleLabels.length} case-visible labels, `
  + 'no sibling run disagrees with itself and no label is spelled two ways'
  + (open ? `. ${open} listed offence${open === 1 ? '' : 's'} remain open in KNOWN and cannot grow.` : '.'),
);

/* ── proving it fails ──────────────────────────────────────────────────────
 *
 * A check that cannot go red is decoration, so each rule was made to fail on
 * a real regression before this was committed:
 *
 *   1. Rule 2, the reported bug put back verbatim in app/(client)/report.tsx —
 *      "Energy {c.energy}/5 · sleep {c.sleep}/5 · mood {c.mood}/5 · adherence
 *      {c.adherence}/5". This is the mutation that found a defect IN THE CHECK:
 *      the JSX-text pattern had been `>[^<>{}\n]*<`, which stops at the first
 *      brace, so the one line this file exists for went straight past it. The
 *      pattern now admits braces and blanks the interpolations afterwards.
 *   2. Rule 1, `<Ghost label="Try Again">` in app/(client)/challenges.tsx
 *      lowered to "Try again" — flagged twice over, once as a label that is not
 *      Title Case and once as a spelling the other 43 places disagree with.
 *   3. The ratchet upward: app/(trainer)/calendar.tsx taken from its listed 2
 *      to 3.
 *   4. The ratchet downward: one of that file's two fixed without lowering the
 *      count, which fails asking for the number to come down with the work.
 */
