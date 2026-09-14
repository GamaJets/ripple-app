#!/usr/bin/env node
// A number nobody reported, written down as zero.
//
// ── the bug, and what a coach does with it ────────────────────────────────
//
// `Number(r.waiting) || 0` reads like "the count, or none". It is not. It is
// the count, or NONE OF THE FOLLOWING TOLD APART: the key was absent, the
// column was null, the string was empty, the value was a word, the RPC never
// answered. `Number(null)` is 0. `Number('')` is 0. `Number([])` is 0.
// `Number(undefined)` is NaN and `|| 0` eats that too. Five different ways of
// not being told, flattened into one confident figure — and then a sentence is
// written from it.
//
// The sentence is the damage. `waitlistLine` in src/lib/booking.ts has exactly
// two arms for a queue length, and 0 takes the second one: "Nobody is waiting
// for this slot yet." That is a claim about other people, made from an unknown,
// and it is the claim a coach acts on when they give somebody's hour away.
// The member who was first in line is not shown as displaced. They are shown as
// never having been there.
//
// The same shape with a different noun, all of it in this tree:
//
//   · `Number(r.energy) || 0` in src/ui/checkins.tsx puts an unrecorded week on
//     a 1–5 wellbeing chart as a 0. src/lib/checkinTrend.ts spends a paragraph
//     on it: "0 on a 1–5 chart is not a low score, it is a HOLE that draws as
//     the worst week of somebody's year", and that file exists to undo this
//     coercion one layer downstream.
//   · `Number(r.discount) || 0` in the offers screen printed "0% off" beside a
//     code the member had already spent — app/(client)/offers.tsx:46-53 calls
//     it "a specific, wrong claim about what their gym owes them, and one they
//     would take to the desk".
//   · `parseFloat(s.kg) || 0` in the session logger wrote an unreadable load as
//     a bodyweight set into somebody else's training history, "and the person
//     it happened to has no way of knowing" (app/(trainer)/log-session.tsx:906).
//
// ── why a gate, and why THIS gate ─────────────────────────────────────────
//
// Six lanes have fixed instances of this by hand: src/ui/coachMoveAt.ts,
// src/lib/moveTimes.ts, src/lib/reschedule.ts, src/ui/sessions.tsx (four
// fields), src/lib/sessionWaitlist.ts and app/(client)/calendar.tsx. The repair
// is always the same — widen the field to `number | null`, carry the unknown,
// and give the screen a sentence for it — and it has never once held the whole
// class, because the wrong form is shorter and reads like defensiveness.
//
// What makes this one worth a gate rather than a seventh hand-fix is what the
// sixth lane proved about the fix: IT DOES NOT GUARD ITSELF. Restore `?? 0` at
// a call site whose field is now typed `number | null` and `tsc` is silent —
// `number` is assignable to `number | null`, so the fabricated zero fits the
// widened type perfectly. Every other check in this directory passes too: it is
// not a clock, not a grant, not a status, not a currency. The type system was
// widened precisely so the unknown could travel, and the type system cannot
// tell you that somebody stopped sending it.
//
// The only thing that changed when the bug came back is the TEXT of the line.
// So this gate reads the text.
//
// ── what it catches ───────────────────────────────────────────────────────
//
// Two rules, both of them `?? 0` or `|| 0` applied to something that is KNOWN
// to carry an unknown — and in both, that knowledge comes from the source of
// the value, never from the name of the variable it lands in.
//
//   RULE 1 — a declared unknown, flattened.
//     `f(<field>) ?? 0`, where `f` is declared with the return type
//     `number | null` (or `number | undefined`), in the file that calls it or
//     in a module that file names in an `import { … }`. That null is not an
//     accident of JavaScript; it is the author of `f` writing down, in the type,
//     that there are inputs about which they will not answer. `queueLength` in
//     src/lib/reschedule.ts returns it. `toNum` in src/ui/sessions.tsx returns
//     it, with a comment saying `Number(null) === 0` is "a live hazard here".
//     `?? 0` at the call site is a caller overruling that, in four characters,
//     silently.
//
//   RULE 2 — a raw coercion of a field, flattened.
//     `Number(<field>) || 0`, `parseInt(<field>, …) || 0`,
//     `parseFloat(<field>) || 0`. No declared null to overrule here; the
//     coercion itself is what erases the difference, per the arithmetic at the
//     top of this header.
//
// ── why the argument must be a FIELD, and what that buys ──────────────────
//
// Both rules require the argument to reach a property or an index —
// `r.my_position`, `d?.waiting`, `set?.[0]`, `payload?.created`. This is the
// whole of the gate's answer to the question the brief for it posed: can the
// source express "nobody told us"?
//
//   A FIELD can. It is read off something handed to this file — a PostgREST
//   row, an RPC payload, a cached blob, a vendor's JSON — and every way of not
//   being handed it (absent key, null column, empty string) collapses to the
//   same 0.
//
//   A LOCAL SCALAR cannot. `readNumber(hrs) ?? 0` where `hrs` is this
//   component's own text-input state is not "nobody told us", it is "nothing
//   typed yet", and a blank box genuinely is not a report from anywhere. There
//   are a dozen of those in the recovery and scan screens and every one is
//   honest.
//
//   `.length` cannot, and is excluded by name. An array's length is a count of
//   rows actually in hand. It is never unknown, so `rows.length ?? 0` and
//   `(arr?.length ?? 0) > 2` are not this defect and are not flagged. (Whether
//   those rows are ALL the rows is a different question with a different gate:
//   check-whole.mjs.)
//
//   A sort comparator's 0 cannot either — `compareIsoDays(a.d, b.d) ?? 0` on a
//   `.sort(` line means "these two do not order", which is a real answer — so a
//   line containing `.sort(` is skipped.
//
// ── WHAT THIS DELIBERATELY CANNOT SEE ─────────────────────────────────────
//
// Stated plainly and at length, because a gate that overclaims is worse than
// one that states its limits. check:currency-copies wrote that lesson down
// after months of "checking" the wrong half of a currency guard while the money
// was wrong; this gate is younger than that sentence and inherits it.
//
//   • IT CANNOT TELL A SERVER ROW FROM A DRAFT ROW. `Number(r.rating) || 0`
//     over a row PostgREST sent and `parseInt(x.reps, 10) || 0` over a set the
//     coach is typing into a box are the same shape to a regex, and the second
//     is usually fine — a blank rep box is a row the filter below drops, not an
//     unreported count. Both are on the ratchet, and the entries say which is
//     which. Anyone tempted to fix this with a naming heuristic should note
//     that half the real server columns here are single words (`waiting`,
//     `rating`, `unread`, `joined`, `freed`, `created`), so snake_case tells
//     you nothing.
//
//   • IT IS LINE-LOCAL AND ONE CALL DEEP. `const n = toNum(r.waiting);` on one
//     line and `n ?? 0` three lines later is invisible: there is no dataflow
//     here, only text. So is `rowOwed(r) ?? 0`, where the field is read INSIDE
//     the callee and the call site shows only a bare identifier. So is a
//     fabricated zero that crosses a function boundary, which is where
//     src/lib/muscleRecovery.ts hides the analogous case for check-whole.
//
//   • IT NEVER ASKS THE TYPE CHECKER ANYTHING. That is the point rather than a
//     shortcoming — see above — but it has a cost worth naming: it recognises a
//     reader by NAME, not by scope. A local `const num = (v: string) => 1` in
//     some other file that also imports a `num` would be misread, and a reader
//     reached through a namespace import, a default export, a re-export chain
//     or a method on an object is not recognised at all.
//
//   • IT CANNOT TELL WHETHER THE ZERO IS EVER RENDERED. `ServerCancel.waiting`
//     in src/ui/sessions.tsx is widened and no sentence reads it yet. That
//     field was widened anyway, and the note there says why: it is an exported
//     field on a report two screens pass around, and "the first caller to word
//     it would inherit the fabricated zero". This gate takes the same line. A
//     fabricated zero that reaches no sentence today is still a fabricated zero
//     travelling in a field.
//
//   • IT DOES NOT READ supabase/functions. Same roots as check:whole,
//     check:utc-day and check:frozen-hook. The defect exists there too — an
//     edge function is where a count is BUILT, not just read — but a count
//     fabricated on the way out is as much a question about the SQL behind it,
//     and check:sql-caps and check:schema are the tools pointed at that.
//
//   • IT TREATS `|| 0` AND `?? 0` ALIKE. `||` is the broader mistake: it also
//     swallows a genuinely reported 0 and rewrites it as the same 0. Since the
//     two are then indistinguishable on the screen, the damage is identical and
//     so is the message.
//
// ── the right forms ───────────────────────────────────────────────────────
//
//   a count of people
//     `queueLength(v)` from src/lib/reschedule.ts. A number must be finite,
//     whole and not negative to be a queue length, a string is read only when
//     it is a string of digits, and everything else is null. It is exported
//     rather than rewritten per provider for exactly this reason.
//
//   any other figure off a row
//     A `number | null` field, and the null carried, not settled. `toNum` in
//     src/ui/sessions.tsx and `num` in src/ui/rosterExercise.ts are the local
//     spellings.
//
//   the sentence at the other end
//     Widening the field is half the work; the screen then needs words for the
//     third state. `waitlistLine(position, waiting)` in src/lib/sessionWaitlist.ts
//     tests the null FIRST, before either arm that compares the count against a
//     number, because `null > 0` is false and a null falls silently into
//     "Nobody is waiting for this slot yet." app/(client)/calendar.tsx and
//     app/(client)/bookings.tsx carry the member-facing wording for an unread
//     queue position.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// Zero is often the honest answer, and where it is, say so — on the line, or in
// the unbroken run of comment lines immediately above it:
//
//     // zero-ok: `seq` is the statement's own ordering key, written by the
//     // same insert that writes the row; a line without one has never existed
//
// The sentence is the point, exactly as with `whole-ok:` in check-whole.mjs,
// `utc-day-ok:` in check-utc-day.mjs and `no-error-ok:` in check-reads.mjs. A
// marker with no reason does not count. Writing the reason means answering one
// question — what does this screen SAY when the value is zero, and is that
// sentence still true when nobody sent one — and that is the question skipped
// every one of the six times this was fixed by hand.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** The three phone apps, the shared code and the web console — everywhere a row
 *  is read and a figure is put on a screen. `supabase/functions` is excluded on
 *  purpose; see the header. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── a ratchet, not an ignore list ─────────────────────────────────────────
 *
 * Same mechanism and the same argument as `KNOWN` in check-utc-day.mjs and
 * check-whole.mjs. A file listed at 3 fails the build at 4, so the backlog can
 * shrink and can never grow; a count that has DROPPED fails too, asking for the
 * number to come down with the work.
 *
 * Two kinds of entry:
 *
 *   [fix]      the zero is a fabrication and something says it out loud.
 *              Widen the field to `number | null`, carry the unknown, and give
 *              the screen words for it.
 *   [annotate] zero is defensible where it stands and what is missing is the
 *              SENTENCE. Paste a `zero-ok:` marker with a reason and the entry
 *              comes off this list.
 *
 * Every entry is open work in a file this lane does not own, and not one was
 * silenced with a marker: a gate's author annotating other people's code is how
 * a rule gets weakened by the person least placed to judge it. The [annotate]
 * labels below are this lane's reading, not a verdict — the owner of the file
 * may find a [fix] under one of them, which is what happened to four of
 * check-utc-day's ten and two of check-whole's thirteen.
 *
 * ── this list is also the liveness guard ──────────────────────────────────
 *
 * The usual empty-set guard (a file-count floor) is below, but the ratchet is
 * the stronger one here. If the scanner ever goes blind — a regex breaks, the
 * comment tracker swallows a tree, a root moves — these entries all drift to
 * zero at once and the run fails loudly, rather than printing `ok` over a tree
 * it never read. (No figure here: it was "31 entries" and the list is meant to
 * shrink, so a hand-kept count is a second fact that goes stale on the first
 * fix. src/ui/joinCode.ts was the first off it — `queueLength` on both
 * headcounts, and null rather than a fabricated queue of nobody.)
 */
const KNOWN = new Map([
  ['app/(client)/onboarding.tsx', { count: 1, fix: '[annotate] a unit conversion for a prefilled box, and the ternary in front of it has already ruled the null out. Mark it `zero-ok:` saying the `== null` arm is the unknown.' }],
  ['app/(client)/workouts.tsx', { count: 8, fix: '[annotate] draft set rows the member is typing, plus two display conversions guarded by a `== null` arm. A blank rep box is not an unreported count. Mark them `zero-ok:` naming the box.' }],
  ['app/(trainer)/calendar.tsx', { count: 2, fix: '[fix] `Number(row.withdrawn) || 0` off an RPC answer. A withdrawal count nobody sent is not a withdrawal count of none — this is the `queueLength` shape exactly.' }],
  ['app/(trainer)/log-session.tsx', { count: 4, fix: '[annotate] `parseInt(s.reps, 10) || 0` over the coach\'s own draft boxes, every one of them immediately compared `> 0` as a validity filter. The file\'s comment at :901 already makes the argument; mark the four lines `zero-ok:` pointing at it.' }],
  ['src/lib/clientTraining.ts', { count: 1, fix: '[annotate] `num(set?.[0]) ?? 0` over a `[reps, kg]` tuple this app wrote itself. Mark it `zero-ok:` saying a set row is dense at the point it is written.' }],
  ['src/lib/coachCredentials.ts', { count: 1, fix: '[fix] `daysUntil(c.expiresOn, today) ?? 0` — an expiry date that would not parse reads as expiring TODAY, which is a specific claim about a coach\'s insurance.' }],
  ['src/lib/coachDocs.ts', { count: 1, fix: '[fix] `Number(r.bytes) || 0` — a document whose size did not come back is shown as a 0-byte file, which reads as an empty upload.' }],
  ['src/lib/openfoodfacts.ts', { count: 3, fix: '[fix] a third-party nutrition API, which is the least trustworthy row shape in the tree. An absent serving size becomes 0 g and the per-serving figures built from it are arithmetic on a guess.' }],
  ['src/lib/planEditsDiff.ts', { count: 1, fix: '[fix] `loadOf(ed.loadKg) ?? 0` — and the `wrote` half on the same line keeps its null, so this diff already disagrees with itself about what an unread load is.' }],
  ['src/lib/setLadder.ts', { count: 1, fix: '[annotate] a display conversion guarded by `s.loadKg == null ? \'\'` in front of it. Mark it `zero-ok:` saying the null arm is the empty string beside it.' }],
  ['src/lib/timedSets.ts', { count: 4, fix: '[annotate] `Number(set?.[0]) || 0` over stored `[reps, kg]` tuples this app wrote. Mark them `zero-ok:` saying a written set row carries both slots.' }],
  ['src/lib/vendorSleep.ts', { count: 3, fix: '[fix] sleep stages off a vendor payload. A stage the vendor did not report is not zero minutes of that stage, and the stage totals are summed into a night.' }],
  ['src/lib/wearables/appleHealth.ts', { count: 3, fix: '[fix] `Number(x?.value) || 0` over native bridge samples, two of them inside a `reduce` that then divides by `res.length` — a sample with no value is counted into the denominator as a zero reading.' }],
  ['src/lib/wearables/appleHealthShim.ts', { count: 1, fix: '[fix] the same sum in the shim. Fix with the file above so the two do not diverge.' }],
  ['src/lib/wearables/cloudProvider.ts', { count: 1, fix: '[fix] `Number(r.mins) || 0` — minutes of activity nobody reported, filed as a day with none.' }],
  ['src/ui/availability.ts', { count: 3, fix: '[annotate] `minute` on a slot, absent from cached rows written by a build that predates the column — and the comment above :125 already says null there means "fall back". Mark the three `zero-ok:` pointing at it.' }],
  ['src/ui/calendarSync.ts', { count: 3, fix: '[fix] `created`, `updated`, `removed` off a sync payload. A sync that answered without counts reads as a sync that changed nothing, which is the sentence a coach checks after granting calendar access.' }],
  ['src/ui/checkins.tsx', { count: 5, fix: '[fix] and it is already documented twice as a defect, from downstream: src/lib/checkinTrend.ts:17 and app/(client)/checkin.tsx:292 both name `Number(r.energy) || 0` and both exist to undo it. The repair belongs here, in `rowToCI`.' }],
  ['src/ui/coachStatement.ts', { count: 1, fix: '[annotate] `seq` is the statement\'s own ordering key, written by the insert that writes the row. Mark it `zero-ok:` saying a line without one has never existed.' }],
  ['src/ui/promos.tsx', { count: 1, fix: '[fix] `Number(r.discount) || 0`, and app/(client)/offers.tsx:46-53 has already fixed the member-facing twin and written down what it cost. Take `discountOf` from there.' }],
  ['src/ui/rosterExercise.ts', { count: 2, fix: '[fix] `recent_outings` and `prior_outings`, counts that `judgeRosterRow` compares against each other. `num` on the same rows already returns null for the loads beside them; these two settle it.' }],
  ['src/ui/seriesPause.ts', { count: 4, fix: '[fix] `freed`, `charged`, `not_freed`, `created` off a pause/resume RPC. Every one of them is a count of sessions a coach is told about after an irreversible action.' }],
  ['src/ui/wellness.tsx', { count: 2, fix: '[fix] `hours` and `quality` off a sleep row, and `quality` is a 1–5 scale — the same hole-drawn-as-a-score that src/lib/checkinTrend.ts spends a paragraph undoing for the check-in chart.' }],
]);

/** A test file. A test that pins the difference between a settled zero and a
 *  carried null has to be able to write both, and reschedule.test.ts does. */
const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.includes('__tests__');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !isTest(p)) out.push(p);
  }
  return out;
}

const files = [];
/* Counted per ROOT, not just in total. A single total threshold cannot notice a
 * root going missing, because the other roots cover for it — see
 * scripts/gate-floor.mjs for the arithmetic. */
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  walk(join(ROOT, r), files);
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:invented-zero', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check: it reports "ok" and a count.
if (files.length < 150) {
  console.error(`check-invented-zero: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

/**
 * A function declared to return a number OR nothing — the codebase's own way of
 * writing down "there are inputs about which I will not answer".
 *
 * Both spellings that occur here: `function name(…): number | null` and
 * `const name = (…): number | null =>`. The parameter list is matched with a
 * lazy `[^;]*?` so that a parameter's own type annotation does not swallow the
 * return annotation.
 */
const NULLABLE_RET = /(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?)\s*(?:<[^<>]*>)?\([^;]*?\)\s*:\s*(?:number\s*\|\s*null|null\s*\|\s*number|number\s*\|\s*undefined|undefined\s*\|\s*number)\b/g;

const sourceOf = new Map();
const declaredIn = new Map();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  sourceOf.set(f, s);
  const names = new Set();
  NULLABLE_RET.lastIndex = 0;
  let m;
  while ((m = NULLABLE_RET.exec(s))) names.add(m[1] || m[2]);
  declaredIn.set(f, names);
}

/** Every such name anywhere in the tree, for matching against import lists. */
const declaredAnywhere = new Set();
for (const s of declaredIn.values()) for (const n of s) declaredAnywhere.add(n);

/** The names a file pulls in through `import { a, b as c } from '…'`. */
function namedImports(src) {
  const out = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * Which lines of a file are prose.
 *
 * A `//` line and a `*`/`/*` continuation, as every gate here does — plus the
 * INSIDE of a `/* … *\/` block, because this tree's long explanations live in
 * JSX comments whose middle lines start with no marker at all, and several of
 * them quote the exact wrong form this gate is looking for (the note on
 * `MyWaitlistRow.position` in app/(client)/bookings.tsx is one). Without the
 * block tracker a file would be failed for the comment explaining why it was
 * fixed.
 *
 * The tracker is naive about `/*` inside a string literal, and deliberately so:
 * it is reset per file, so the worst a stray marker can do is blind ONE file,
 * and the ratchet above turns a blinded file into a loud drift failure rather
 * than a silent pass.
 */
function proseLines(lines) {
  const prose = new Array(lines.length).fill(false);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inBlock) {
      prose[i] = true;
      if (l.includes('*/')) inBlock = l.lastIndexOf('/*') > l.lastIndexOf('*/');
      continue;
    }
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) prose[i] = true;
    const open = l.lastIndexOf('/*');
    if (open >= 0 && l.lastIndexOf('*/') < open) inBlock = true;
  }
  return prose;
}

/**
 * Does a marker apply to `line` (1-based)? On the line itself, or in the
 * unbroken run of comment and blank lines above it — a run and not a fixed
 * window, so an annotation cannot drift down onto the next statement.
 */
function markedAbove(lines, line, re) {
  if (re.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (re.test(l)) return true;
  }
  return false;
}

/**
 * The operand immediately left of an operator at `idx`, when it is a call.
 *
 * Walked with a paren counter rather than matched with a regex, because the
 * argument is routinely a call of its own — `seconds(st.total_light_sleep_time_milli, 1 / 1000)`
 * — and `\([^)]*\)` stops at the first `)` it meets and reads the callee off the
 * wrong expression.
 *
 * `chained` says the callee was reached through a `.`: `rows.map(…) || 0` is a
 * method on a value, not one of the readers this gate knows, and the two rules
 * below both decline it.
 */
function callBefore(line, idx) {
  let i = idx - 1;
  while (i >= 0 && /\s/.test(line[i])) i--;
  if (i < 0 || line[i] !== ')') return null;
  const end = i;
  let depth = 0;
  for (; i >= 0; i--) {
    if (line[i] === ')') depth++;
    else if (line[i] === '(') { depth--; if (depth === 0) break; }
  }
  if (i < 0) return null;
  const arg = line.slice(i + 1, end);
  let j = i - 1;
  while (j >= 0 && /\s/.test(line[j])) j--;
  let k = j;
  while (k >= 0 && /[\w$]/.test(line[k])) k--;
  const callee = line.slice(k + 1, j + 1);
  if (!callee) return null;
  return { callee, arg, chained: /[\w$\])]\s*\??\.\s*$/.test(line.slice(0, k + 1)) };
}

/** The coercions that erase the difference by themselves. */
const COERCIONS = new Set(['Number', 'parseInt', 'parseFloat']);

/** The argument reaches a property or an index: `r.x`, `d?.x`, `set?.[0]`,
 *  `rows[i].x`. This is what says the value came from outside this file. */
const REACHES_A_FIELD = /[\w$\]\)]\s*\??\.\s*[A-Za-z_$]|\?\.\s*\[|[\w$]\s*\[/;

/** …but not `.length`, which is a count of rows in hand and cannot be unknown. */
const IS_A_LENGTH = /\.\s*length\b/;

/** `?? 0` or `|| 0`, where the 0 is the whole literal — not `0.5`, not `0x20`. */
const COALESCE_TO_ZERO = /(\?\?|\|\|)\s*0(?![\w$.\d])/g;

const found = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = sourceOf.get(f);
  const readers = new Set(declaredIn.get(f));
  for (const n of namedImports(src)) if (declaredAnywhere.has(n)) readers.add(n);

  const lines = src.split('\n');
  const prose = proseLines(lines);
  lines.forEach((line, i) => {
    if (prose[i]) return;
    /* A comparator's zero means "these two do not order", which is a real
     * answer about two values both of which were read. */
    if (/\.\s*sort\s*\(/.test(line)) return;

    COALESCE_TO_ZERO.lastIndex = 0;
    let m;
    while ((m = COALESCE_TO_ZERO.exec(line))) {
      const call = callBefore(line, m.index);
      if (!call || call.chained) continue;
      if (!REACHES_A_FIELD.test(call.arg) || IS_A_LENGTH.test(call.arg)) continue;

      let rule = null;
      if (COERCIONS.has(call.callee)) {
        rule = {
          n: 2,
          wrong: `\`${call.callee}(${call.arg.trim().slice(0, 40)}) ${m[1]} 0\` — ${call.callee}(null) and ${call.callee}('') are 0, ${call.callee}(undefined) is NaN, and \`${m[1]} 0\` takes the last of them too. An absent key, a null column, an empty string and a word all arrive here as the same confident figure`,
        };
      } else if (readers.has(call.callee)) {
        rule = {
          n: 1,
          wrong: `\`${call.callee}\` is declared to return \`number | null\`, which is its author writing down that there are inputs it will not answer for — and \`${m[1]} 0\` at the call site overrules that in four characters`,
        };
      }
      if (!rule) continue;
      if (markedAbove(lines, i + 1, /zero-ok:\s*\S/)) continue;
      found.push({ rel, line: i + 1, rule: rule.n, wrong: rule.wrong, text: line.trim().slice(0, 110) });
    }
  });
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const byFile = new Map();
for (const h of found) {
  if (!byFile.has(h.rel)) byFile.set(h.rel, []);
  byFile.get(h.rel).push(h);
}

const fresh = [];
for (const [rel, hits] of byFile) {
  const allowed = KNOWN.get(rel)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed, total: hits.length })));
}

const drifted = [];
for (const [rel, entry] of KNOWN) {
  const n = byFile.get(rel)?.length ?? 0;
  if (n < entry.count) drifted.push({ rel, was: entry.count, now: n, fix: entry.fix });
}

if (fresh.length) {
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${fresh.length} figure${fresh.length === 1 ? '' : 's'} nobody reported, written down as zero:\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}   (rule ${h.rule})`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: ${h.wrong}`);
    console.error('    right: carry the unknown. `queueLength(v)` from src/lib/reschedule.ts for a');
    console.error('           count of people, a `number | null` field for anything else — and a');
    console.error('           sentence at the other end for the third state, the way');
    console.error('           `waitlistLine` in src/lib/sessionWaitlist.ts tests the null FIRST');
    if (h.allowed) console.error(`    (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error('');
  }
  console.error('"Nobody is waiting for this slot yet." is a claim about other people, and a');
  console.error('coach gives somebody\'s hour away on it. A count nobody took is not an empty');
  console.error('queue. If zero is genuinely the answer here — a real reading, an index, an');
  console.error('accumulator seed — say which: `zero-ok: <why zero is a real answer here>`.\n');
  process.exit(1);
}

if (drifted.length) {
  console.error(`\n${drifted.length} ratchet entr${drifted.length === 1 ? 'y is' : 'ies are'} out of date — the backlog has shrunk and the list has not:\n`);
  for (const d of drifted) {
    console.error(`  ${d.rel}: listed at ${d.was}, now ${d.now}. ${d.now === 0 ? 'Delete the entry.' : `Lower the count to ${d.now}.`}`);
    console.error(`    ${d.fix}\n`);
  }
  console.error('A list that over-states what is wrong is how a ratchet turns into an ignore');
  console.error('list. The number comes down with the work. (If EVERY entry is listed here at');
  console.error('once, suspect the scanner rather than the tree — this list is also this');
  console.error("gate's liveness guard.)\n");
  process.exit(1);
}

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(`check-invented-zero — ok, ${files.length} files; no new unreported figure settled to zero${backlog ? `, ${backlog} known and ratcheted` : ''}`);
