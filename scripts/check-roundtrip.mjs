#!/usr/bin/env node
// Every field a coach can edit must survive being saved and opened again.
//
// `app/(trainer)/builder.tsx` converts between its own editing type `BEx` and
// the stored `ProgramExercise`, twice, and BOTH conversions enumerate fields BY
// HAND:
//
//   loadFrom        stored programme  ->  BEx   (opening a template)
//   composeProgram  BEx  ->  stored programme   (saving or assigning one)
//
// A field added to `BEx` and to only one of them — or to neither — compiles,
// passes every test, and looks correct on screen for exactly as long as the
// screen stays open. The loss happens on the round trip, in silence, to a
// programme somebody spent twenty minutes writing.
//
// This has now happened FOUR times:
//
//   loadKg      the weight on the machine        dropped, fixed later
//   note        the coach's cue for a movement   dropped, fixed later
//   setGroupId  supersets and giant sets         shipped dropped
//   method      warm-up, drop set, to failure    shipped dropped
//   loadUnit    kg or lb as the coach typed it   never stored at all
//
// The last two went out over the air. A coach who supersetted three movements
// and marked a drop set, saved it as a template and opened it again got an
// ordinary ungrouped week back, with nothing on screen to say so.
//
// Nothing else in this repo can see it. TypeScript is happy — every field is
// optional, because a programme written by an older build genuinely may not
// have it. The tests exercise the pure modules, not this screen's two mappers.
// So it is checked here, by name, against the type itself.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// Every property declared on `BEx` appears as a key in the object literal
// inside BOTH mappers. Fields that are deliberately not stored go in
// EDIT_ONLY below, with the reason — a list somebody must edit on purpose is
// the point, because the whole failure mode is forgetting.

import { readFileSync } from 'node:fs';

const FILE = 'app/(trainer)/builder.tsx';

// Fields that exist only while the screen is open and must NOT be stored.
// Adding to this list is a decision; it is short deliberately.
const EDIT_ONLY = {};

// Fields both mappers MINT rather than carry. Different from edit-only: these
// are written on both sides, so they must appear in both literals — but the
// value that comes out is not the value that went in, and that is correct.
//
// `key` is the only one. `loadFrom` mints it with nextKey() for React's list
// identity, and `composeProgram` writes a positional `day-index` so the stored
// programme has something stable to name a row by. Carrying one into the other
// would drag a session's identity into the next.
const DERIVED = {
  key: 'minted by nextKey() on load and positionally on save; identity, not content',
};

const src = readFileSync(FILE, 'utf8');

const fail = (msg) => { console.error(msg); process.exit(1); };

// ── the declared fields ───────────────────────────────────────────────────
const typeMatch = src.match(/\ntype BEx = \{([\s\S]*?)\n\};/);
if (!typeMatch) fail(`${FILE}: could not find "type BEx = { ... };" — this check is reading the wrong shape and is not protecting anything.`);

// Strip block and line comments before reading keys, so a field named in prose
// is not mistaken for a declaration.
const body = typeMatch[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const declared = [...body.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
const unique = [...new Set(declared)];
if (unique.length < 5) fail(`${FILE}: only found ${unique.length} field(s) on BEx. The type has been reshaped and this check can no longer read it.`);

// ── the two mappers ───────────────────────────────────────────────────────
// Each is the object literal inside `exercises: d.exercises.map(... => ({ ... }))`.
const allLiterals = [...src.matchAll(/exercises:\s*d\.exercises\.map\(\((?:[^)]*)\)\s*=>\s*\(?\{([\s\S]*?)\n\s*\}\)?\)/g)]
  .map((m) => m[1]);

// Only the ENUMERATING literals are at risk. The others in this file are of the
// form `{ ...e, setGroupId: ids[k] }` — a spread carries every field including
// ones added later, which is precisely why those have never lost anything and
// these two have lost four things between them.
// The spread must be at the TOP level of the literal to count. `loadFrom`
// contains `setRows.map((r) => ({ ...r }))` nested inside it, and a naive
// search for "..." anywhere excused the very mapper this check exists for.
const spread = (lit) => /^\s*\.\.\.[a-zA-Z_]/.test(lit);
const mappers = allLiterals.filter((lit) => !spread(lit));

// `loadFrom` became a spread when the builder learned multi-week blocks, and
// that is the SAFER shape, not a regression: `{ ...e, key: nextKey() }` carries
// every field on BEx including ones added after it was written, which is the
// whole reason the spread mappers in this file have never lost anything. So it
// is no longer enumerated and cannot be read field-by-field — what this check
// verifies about it now is that it is STILL a spread, because the day somebody
// expands it back into a list of names is the day it starts dropping fields.
const intoEditorSpread = allLiterals.find((lit) => spread(lit) && /\bkey:\s*nextKey\(\)/.test(lit));

if (!intoEditorSpread) {
  fail(`${FILE}: could not find loadFrom — the mapper that mints \`key: nextKey()\` when a saved `
     + `programme is opened. It must stay a top-level spread (\`{ ...e, key: nextKey(), … }\`) so that `
     + `every field on BEx survives being opened, including ones added after it was written. `
     + `If it has been expanded into a list of named fields, this check can no longer tell whether it drops any.`);
}

if (mappers.length !== 1) {
  fail(`${FILE}: expected exactly 1 enumerating exercise mapper (composeProgram), found ${mappers.length}. `
     + `Either it was removed, or another was added — in both cases this check is no longer looking at what it claims to.`);
}
const [outToStorage] = mappers;

const keysOf = (literal) =>
  new Set([...literal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .matchAll(/(?:^|[\s{,])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]));

const inStorage = keysOf(outToStorage);

const problems = [];
for (const f of unique) {
  if (f in EDIT_ONLY) {
    if (inStorage.has(f)) problems.push(`  ${f}  is listed as edit-only but composeProgram writes it. ${EDIT_ONLY[f]}`);
    continue;
  }
  // Only composeProgram is enumerated now. loadFrom spreads, so it carries
  // every field by construction and there is nothing per-field to check there.
  if (!inStorage.has(f)) {
    problems.push(`  ${f}  is on BEx but not carried by composeProgram (saving or assigning one)`);
  }
}

if (problems.length) {
  console.error(`${problems.length} field(s) will be lost on the round trip:\n`);
  console.error(problems.join('\n'));
  console.error(`
A field on BEx that either mapper does not name is edited on screen, looks
correct, and disappears the moment the programme is saved and opened again.
Nothing else catches it: every field is optional, so TypeScript is satisfied.

Add it to composeProgram in ${FILE}, or — if it genuinely must not be stored —
to EDIT_ONLY in this script with the reason it is one.`);
  process.exit(1);
}

console.log(`round trip ok — all ${unique.length - Object.keys(EDIT_ONLY).length - Object.keys(DERIVED).length} stored fields on BEx survive being saved and opened again, and ${Object.keys(DERIVED).length} derived one is written by both.`);
