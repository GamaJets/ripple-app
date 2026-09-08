#!/usr/bin/env node
// A write whose success was inferred rather than counted.
//
// ── the bug, and why check-reads.mjs is not enough ────────────────────────
//
// check-reads.mjs holds the read side of this and its header states the reason:
// supabase-js does not reject on a database error. It RESOLVES, with `error`
// set. Everything that follows from that on a read — a fabricated empty answer
// stated as a fact — follows on a WRITE too, and worse, because a read that
// fails shows you nothing and a write that fails shows you exactly what you
// typed, sitting there, apparently saved.
//
//     await supabase.from('push_tokens').upsert({ user_id: uid, token, … });
//     await rememberToken(token);
//
// That is real, in src/ui/pushNotifications.ts, and the two lines after it are
// a comment explaining that the note must be written AFTER the upsert, because
// "a note written for a row that was never inserted would send the revoke
// hunting for something that never existed". Which is precisely what happens.
// The upsert does not throw when the policy refuses it; it resolves with an
// error nobody reads, `rememberToken` runs anyway, and the invariant the
// comment was written to protect is broken by the missing line the comment
// never thought to ask for. The file understood the danger and still shipped it.
//
// The same shape in src/lib/wearables/oauth.ts sits inside a `try/catch` whose
// whole purpose is to notice the failure — and cannot, because there is nothing
// to catch. That function is called `disconnectVendor`, and its own header
// records that it USED to be a no-op with a comment claiming the work happened
// elsewhere. A member who taps Disconnect and is refused by RLS is told the
// vendor is disconnected, and the token stays.
//
// ── why a gate and not a fix ──────────────────────────────────────────────
//
// Because "the await returned, so it worked" is not a mistake, it is an
// inference — and it is the correct inference for every other promise-returning
// API any of us have used. It is wrong here for one library-specific reason,
// and that reason is invisible at the call site. There is nothing on the line
// to notice. Reviewers have swept these files; the sweeps found the reads,
// because a read has a `data` you can see being used, and walked past the
// writes, because a write has nothing to look at at all.
//
// ── what counts as looking ────────────────────────────────────────────────
//
// Any of these, anywhere in the chain:
//
//   · the result is BOUND — `const { error } = await …`, `return await …`,
//     an element of a `Promise.all([…])`. Whoever holds it can read `error`,
//     and check-reads.mjs and the type checker take it from there.
//   · `.then(({ error }) => …)` — a fire-and-forget that still inspects. This
//     is how src/lib/reportError.ts and src/ui/ErrorBoundary.tsx queue a crash
//     report that did not land, and it is correct.
//   · `{ count: 'exact' }` in the mutation options — the row count comes back
//     and can be compared. src/ui/coachProfile.tsx and src/ui/settings.tsx do
//     this, and coachProfile then names WHICH half of a two-write save failed,
//     because "your profile did not save" leaves a coach unable to tell whether
//     it is their name or their rate that is still only on the handset.
//   · `.select('id')` — the write hands back the rows it touched, so an empty
//     array is a write that matched nothing.
//
// This flags only the fourth case: a mutation standing alone as a STATEMENT,
// with none of the above, whose value goes nowhere at all. That is deliberately
// the narrowest possible rule. It cannot tell whether a bound result is
// actually inspected — `const { data } = await …update(…)` and then never
// reading `error` is a real defect this will not see — but check-reads.mjs
// already covers that destructure, and a second gate guessing at the same line
// from a different angle would double-report it. Narrow and quiet, on purpose.
//
// ── the second rule: an update or a delete that matched nothing ──────────
//
// The paragraph above defers the bound case to check-reads.mjs, and for the
// `error` question that is the right call: check-reads flags
// `const { data } = await …` with no `error` on the line, so a second gate on
// that shape would only double-report it. But read what check-reads does when
// `error` IS on the line — `if (/\berror\b/.test(line)) return;`. It stops
// there. And src/lib/wroteRows.ts opens by explaining, at length, that on an
// UPDATE or a DELETE reading `error` is not the check:
//
//     const { error } = await sb.from('memberships').update({ status }).eq('id', id);
//     if (error) throw error;          // never throws
//
// A PostgREST update or delete that matches zero rows is a 204 with a null
// error. An RLS policy refused it, or the row is gone, or the id is stale from
// a list drawn before a refresh — all three arrive as success. So "result
// bound, `error` read, count never read" is not covered by check-reads, which
// stops at `error`; is not covered by the rule above, because the value is
// bound; and is the shape that has shipped here twice. A settlement write
// returned 204-with-null-error having stamped zero sessions, and a payroll run
// showed as paid while every session stayed payable.
//
// This is not the second angle on the same line that the paragraph above
// refuses. It is a different rule over a DISJOINT population — no site can be
// reported by both, and the loop enforces that by reporting the first rule and
// moving on — asking a question no gate in this repo asks. Its narrowness is
// bought with scope rather than with omission:
//
//   · UPDATE and DELETE only. An insert cannot silently affect zero rows, and
//     neither can an upsert's ON CONFLICT DO UPDATE path: a conflicting row
//     that fails the UPDATE policy's USING clause RAISES rather than being
//     skipped. There are 130 inserts and upserts in these roots, and a rule
//     that flagged them would be wrong 130 times on the day it landed, which
//     is how a gate gets deleted rather than fixed. The one upsert shape that
//     CAN come back empty on purpose — `ignoreDuplicates: true`, where the
//     ignored duplicate returns no rows — is the shape where counting would be
//     actively wrong: src/ui/messaging.ts says so above its own block-thread
//     upsert, and it is right.
//   · The chain, not the statement, and not a window. `{ count: 'exact' }` can
//     sit a long way from the `.update(` it belongs to — in src/ui/clientData.tsx
//     it is 19 lines and about 1,050 characters below it — so any rule measured
//     in lines or characters reports that counted write as an uncounted one.
//     `chainText` walks brackets to the end of the chain however long it is, and
//     stops at a depth-zero comma so that one element of a `Promise.all([…])`
//     cannot borrow its sibling's count.
//   · A builder passed as an ARGUMENT is skipped, on the same
//     false-negative-by-choice rule `exprStart` already states below. In
//     src/ui/workoutLog.tsx the builder goes into `matchRow(…)` and the
//     `.select('id')` is chained onto what comes back, where this cannot see
//     it. Two false positives, both declined. `enclosingOpener` tells a call's
//     parenthesis from a grouping one, so the `({ error } = await …)` form in
//     src/lib/wearables/oauth.ts is still reached.
//
// ── the escape hatch, which is the one that already exists ────────────────
//
// `no-error-ok:` with a reason, the same marker check-reads.mjs reads and in
// the same place — on the line or in the three above it:
//
//     // eslint-disable-next-line -- no-error-ok: the file is already in the
//     // owner's hands; a logging failure must not be reported as an export failure
//
// Two writes in the console already carry exactly that (studio-web/app/export
// and studio-web/app/members, both logging an export that has already happened)
// and both pass here untouched. That is the point of honouring the existing
// convention rather than minting a second one: the annotations people have
// already written keep working, and there is one marker to remember instead of
// two. The reason is what a reviewer reads when deciding whether a write that
// silently did nothing is honestly survivable here.
//
// The count rule gets its OWN marker, `no-count-ok:`, and that is this repo's
// precedent rather than a departure from it. There are twenty-one `…-ok:`
// markers in this tree — `rtl-ok:`, `utc-day-ok:`, `grant-ok:`, `unit-ok:`,
// `whole-ok:` — one per rule, and this file reuses `no-error-ok:` for its first
// rule precisely because that rule asks check-reads.mjs's question. The count
// rule asks a different one, so it says a different sentence.
//
// The distinction is not decorative. `no-error-ok:` claims a FAILED write is
// survivable. Every site the count rule can reach already reads `error` and
// reports it — its author does not think a failure is survivable, they think
// ZERO ROWS is a legitimate outcome, which is a narrower and quite separate
// claim. Writing `no-error-ok:` there would put a false sentence in the source
// AND switch off the first rule, so a later edit deleting the `if (error)`
// branch would pass unnoticed. Two markers, two blast radii.
//
//     // no-count-ok: the member asked for no quiet hours and there are none;
//     // a delete that matched nothing is the outcome here, not a failure
//
// Both markers go through `markedAbove`, so a reason wrapped onto a second line
// must carry a comment prefix. A sibling gate matched `/-ok:\s*\S/` inside an
// HTML comment, where a wrapped reason has no `//` or `*` in front of it and the
// comment-run test walks straight past it; that cannot happen here, because
// these roots hold only .ts and .tsx.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** The same roots as check-reads.mjs, plus the console's components: the web
 *  console writes the same tables through the same client and has the same
 *  failure mode. */
const ROOTS = ['src', 'app', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];

/**
 * Does a marker apply to the statement starting on `line` (1-based)?
 *
 * The marker may sit on the line itself, or anywhere in the unbroken run of
 * comment and blank lines immediately above it. NOT "the three lines above",
 * which is what check-reads.mjs uses and what the first draft of this file
 * copied — and it was wrong here on the very first file it ran on. In
 * src/ui/auth.tsx a read carrying a `no-error-ok:` sits three lines above a
 * write that carries nothing, and a fixed window silently let the read's
 * annotation excuse the write. A marker has to be attached to the thing it
 * excuses; a run of code between them means it is attached to something else.
 */
function markedAbove(lines, line, re) {
  if (re.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;                       // blank, keep looking
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;   // real code — the run has ended
    if (re.test(l)) return true;
  }
  return false;
}

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * A ratchet, not an ignore list, on the terms `KNOWN` sets out in
 * check-dead-exports.mjs: listed at 1, fails at 2, and a count that has dropped
 * fails too so the list can only shrink. All three are open work in files this
 * lane does not own. None was silenced with a marker, because a gate's author
 * annotating other people's code is how a rule gets weakened by the person
 * least placed to judge it.
 *
 * `src/lib/wearables/oauth.ts` is cleared. `disconnectVendor` now reads the
 * delete's `error` and throws, and the fix did not stop at the write: the two
 * callers above it — `disconnect` in src/ui/wearables.tsx and `onDisconnect` in
 * app/(client)/devices.tsx — went on to set 'disconnected', clear the metrics
 * and delete every night the device had measured, all on the strength of a
 * write nobody had checked. Reading the error without stopping that would have
 * left the member in the same place, plus a log line.
 *
 * `src/ui/auth.tsx` is cleared, and the list is now empty. The entry asked for
 * the missing ARGUMENT about `verifyPhoneCode`'s `full_name` fill, and the
 * argument turned out to run the other way. "Survivable, the name can be set
 * again later" is true of the WRITE and false of the pair: the read three lines
 * above it — the one whose `no-error-ok:` this entry pointed at — resolves a
 * refusal to `prof = null`, which `!((prof)?.full_name || '').trim()` reads as
 * "there is no name", so a read that merely failed sent the update, and the
 * update replaced an existing member's name with whatever the sign-in screen
 * had in its field. The function's own doc comment forbids exactly that. So the
 * read now branches on `error` instead of excusing it, the write carries
 * `{ count: 'exact' }` and reports through `writeFailure`, and the sign-in
 * still succeeds either way — which was the only part of the old defence that
 * was about this code rather than about not looking.
 *
 * Left EMPTY rather than deleted. The ratchet reads `KNOWN.get(rel)?.count ?? 0`
 * and walks the entries for drift, so an empty map is a working gate at zero,
 * and the next lane adding an entry has the shape and this note in front of it.
 */
const KNOWN = new Map([]);

/**
 * The count rule's own ratchet, kept SEPARATE from `KNOWN` above rather than
 * folded into it.
 *
 * A shared map would let an allowance granted for one rule absorb an offence
 * against the other: a file listed here at 1 for an uncounted delete would then
 * hide a brand-new unlooked-at write, because the two would be counted into the
 * same total. `KNOWN` stays at zero and means what it says.
 *
 * Both entries are CORRECT code. Each is a delete where zero matched rows is
 * the outcome the member asked for, and each already carries its author's
 * paragraph saying exactly that — src/ui/wearables.tsx even names
 * src/lib/wroteRows.ts and explains why the rule there does not apply. All that
 * is missing is the marker, and the marker is a one-line edit sitting on top of
 * the sentence that justifies it.
 *
 * They are ratcheted rather than marked because src/ui/ belongs to another
 * lane, and the header above `KNOWN` gives the reason: a gate's author
 * annotating other people's code is how a rule gets weakened by the person
 * least placed to judge it. The three sites in src/lib that this rule also
 * reached WERE marked, because this lane can answer for them.
 */
const KNOWN_COUNT = new Map([
  ['src/ui/quietHours.ts', {
    count: 1,
    fix: "The delete in `saveQuietHours` when `q` is null. The comment under it already says \"A delete that matched nothing is a success here and only here\" — put that in a `no-count-ok:` above the write and this entry goes away.",
  }],
  ['src/ui/wearables.tsx', {
    count: 1,
    fix: "The `device_sleep_nights` delete in `forgetSleep`. Its comment already reads \"Zero rows is success here, not silence\" and names src/lib/wroteRows.ts as the rule it is departing from; that sentence is the `no-count-ok:` reason, it just needs the marker in front of it.",
  }],
]);

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

/**
 * The source with comments and string bodies blanked to spaces of the same
 * length, so offsets, line numbers and bracket balance are untouched.
 *
 * Necessary here for the same reason as in check-frozen-day.mjs: the files this
 * gate is about carry long comments QUOTING the defective form, and a scanner
 * that reads prose reports every explanation as an instance of the thing it
 * explains.
 */
function blank(src) {
  const out = Array.from(src);
  let i = 0;
  const space = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; space(i, j); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; space(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      space(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** The mutation verbs. `upsert` is here because an upsert that is refused is
 *  indistinguishable from one that matched — the most silent of the four. */
const MUTATES = /\.(insert|update|upsert|delete)\s*\(/;

/**
 * Where the expression containing `.from(` at `at` begins.
 *
 * Walks back over the receiver — `supabase`, `sb`, `this.db`, `client?.` — and
 * over the whitespace between its parts, because the house style breaks these
 * chains across lines and `await sb\n  .from('x')\n  .update(…)` is one
 * expression however it is laid out. It stops at anything that is not an
 * identifier: an `=`, a `,`, a `[`, a `;`, a brace.
 *
 * A receiver that is itself a CALL — `getClient().from(…)` — stops the walk at
 * the `)`, which is then read as "the value flows somewhere" and the statement
 * is skipped. A false negative, chosen deliberately over a false positive, on
 * the standing rule that a gate people suppress is worse than a gate that
 * misses one shape.
 */
function exprStart(src, at) {
  let i = at;
  for (;;) {
    let j = i;
    while (j > 0 && /\s/.test(src[j - 1])) j--;
    if (j > 0 && /[A-Za-z0-9_$.?]/.test(src[j - 1])) {
      let k = j;
      while (k > 0 && /[A-Za-z0-9_$.?]/.test(src[k - 1])) k--;
      i = k;
      continue;
    }
    return j === i ? i : j === 0 ? 0 : i;
  }
}

/**
 * The token immediately before `i`, ignoring whitespace — and stepping back
 * over `await` / `void`, which are prefixes rather than destinations. `await x`
 * as a statement discards the value exactly as `x` does.
 */
function before(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return { ch: '', two: '', word: '' };
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
  const word = src.slice(k + 1, j + 1);
  if (word === 'await' || word === 'void') return before(src, k + 1);
  return { ch: src[j], two: src.slice(Math.max(0, j - 1), j + 1), word };
}

/** A statement, from `start`, to the `;` that ends it at depth zero. */
function statementText(src, start) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return src.slice(start, j); depth--; }
    else if (c === ';' && depth === 0) return src.slice(start, j);
  }
  return src.slice(start);
}

/**
 * The single CHAIN from `start` — `sb.from(…).update(…).eq(…)` — and nothing
 * that follows it.
 *
 * `statementText` above is right for the first rule, which asks a question about
 * the statement as a whole. The count rule asks about one mutation, so it needs
 * one mutation's worth of text: a comma at depth zero ENDS the chain, which
 * `statementText` runs straight through. Without that, the two updates inside
 * the `Promise.all([…])` in src/ui/clientData.tsx are one span, and either one
 * carrying `{ count: 'exact' }` would excuse the other.
 *
 * Everything else is deliberately the same walk, brackets and all, because the
 * count that guards a write is not at any fixed distance from it. That same
 * clientData update carries its `{ count: 'exact' }` 19 lines and about 1,050
 * characters below the `.update(`, so a rule with a line or character window
 * would report the best-guarded write in the tree as an unguarded one.
 */
function chainText(src, start) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return src.slice(start, j); depth--; }
    else if ((c === ';' || c === ',') && depth === 0) return src.slice(start, j);
  }
  return src.slice(start);
}

/**
 * The innermost bracket still open at `start`: `'call'`, `'('`, `'['`, `'{'` or
 * `''`.
 *
 * `'call'` means the mutation is an ARGUMENT to a function, and the count rule
 * then declines to judge it — whatever that function returns can be chained on
 * where this cannot see it, which is exactly what src/ui/workoutLog.tsx does
 * with `matchRow(sb.from('workouts').update(patch), …).select('id')`. Same
 * false-negative-over-false-positive trade `exprStart` makes for a call
 * receiver, for the same reason.
 *
 * Which is why a bare `(` is not enough to decide. `({ error } = await sb
 * .from('wearable_tokens').delete()…)` in src/lib/wearables/oauth.ts is wrapped
 * in a GROUPING parenthesis — the house form for destructuring into an
 * already-declared binding — and treating that as an argument would lose a real
 * call site. A parenthesis is a call's only when something callable sits
 * immediately in front of it.
 */
function enclosingOpener(src, start) {
  let depth = 0;
  for (let j = start - 1; j >= 0; j--) {
    const c = src[j];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth--; continue; }
      if (c !== '(') return c;
      let k = j - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      return k >= 0 && /[A-Za-z0-9_$\])]/.test(src[k]) ? 'call' : '(';
    }
  }
  return '';
}

const files = [];
/* Counted per ROOT, not just in total. A single total threshold cannot notice a
 * root going missing, because the other roots cover for it — see
 * scripts/gate-floor.mjs for the arithmetic and why 150-of-781 was not a guard. */
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  walk(join(ROOT, r), files);
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:writes', perRoot);

// The empty-set guard every gate here has. The first version of check-reads.mjs
// reported success having read nothing; that is the failure this line exists to
// make impossible.
if (files.length < 150) {
  console.error(`check-writes: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
/* What the gate actually looked at, so the success line reports a size rather
 * than only a verdict. A gate that says "ok" without saying over what is one
 * bad glob away from saying "ok" over nothing — the same failure the file-count
 * floor above exists to prevent, one level down. */
let examined = 0;
let updateOrDelete = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = blank(raw);
  const rel = relative(ROOT, f);
  const rawLines = raw.split('\n');

  for (let at = src.indexOf('.from('); at >= 0; at = src.indexOf('.from(', at + 1)) {
    const start = exprStart(src, at);
    const stmt = statementText(src, start);
    if (!MUTATES.test(stmt)) continue;
    // The same span out of the ORIGINAL text. `blank()` empties string bodies
    // to keep offsets honest, which also empties `'exact'` — so the test for
    // `{ count: 'exact' }` has to read the real characters or it would report
    // every counted write in the tree as an uncounted one.
    const rawStmt = raw.slice(start, start + stmt.length);

    const line = src.slice(0, start).split('\n').length;
    const text = rawLines[line - 1].trim().slice(0, 110);

    /* ── rule one: nobody can read `error`, because nobody holds the result ── */

    // Is the value going anywhere? Anything that binds, returns, or passes it
    // along means somebody downstream can read `error`.
    const head = before(src, start);
    const w = head.word;
    const held =
      w === 'return' || w === 'yield'
      || head.two === '=>' || head.two === '&&' || head.two === '||' || head.two === '??'
      || '=(,[:?+'.includes(head.ch)
      // Is it being inspected in place?
      || /\.then\s*\(/.test(stmt)
      || /\.select\s*\(/.test(stmt)
      || /count\s*:\s*['"]exact['"]/.test(rawStmt)
      || markedAbove(rawLines, line, /no-error-ok:\s*\S/);

    if (!held) {
      found.push({ kind: 'error', rel, line, text, verb: (MUTATES.exec(stmt) || [, 'write'])[1] });
      // One report per site. A statement that fails rule one would fail rule
      // two as well — it has no count either — and two paragraphs about one
      // line is the double-reporting the header refuses. Rule one's remedy
      // already names the count for an update or a delete.
      continue;
    }

    /* ── rule two: the result is held, but the ROW COUNT is not read, and on
     *    an update or a delete that is the whole question ─────────────────── */

    // The chain rather than the statement, so a sibling's count cannot be
    // borrowed and a count 19 lines down is still found. See `chainText`.
    const chain = chainText(src, start);
    const rawChain = raw.slice(start, start + chain.length);
    const m = MUTATES.exec(chain);
    if (m) { examined++; if (m[1] === 'update' || m[1] === 'delete') updateOrDelete++; }

    // Insert and upsert are outside the class: neither can silently affect zero
    // rows. The header sets out why, and why a rule that flagged them would be
    // wrong 130 times on the day it landed.
    if (!m || (m[1] !== 'update' && m[1] !== 'delete')) continue;

    // Passed to a function, which may chain a `.select(…)` onto what it returns
    // where this cannot see it. Declined rather than guessed.
    if (enclosingOpener(src, start) === 'call') continue;

    // The two guard forms that answer the question. `{ count: 'exact' }` has to
    // be read out of the RAW text for the reason given above: `blank()` empties
    // `'exact'` along with every other string body.
    if (/count\s*:\s*['"]exact['"]/.test(rawChain)) continue;
    if (/\.select\s*\(/.test(chain)) continue;
    // `.single()` turns zero rows into PGRST116, so it is a count guard in its
    // own right. `.maybeSingle()` deliberately is NOT — it resolves zero rows to
    // null data with no error, which is the very shape this rule is about.
    if (/\.single\s*\(/.test(chain)) continue;

    if (markedAbove(rawLines, line, /no-count-ok:\s*\S/)) continue;

    found.push({ kind: 'count', rel, line, text, verb: m[1] });
  }
}



/**
 * Two populations, two ratchets, the same arithmetic. `kind` decides which, and
 * because the loop reports at most one kind per site the two totals never
 * overlap.
 */
function ratchet(hits, known) {
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.rel)) byFile.set(h.rel, []);
    byFile.get(h.rel).push(h);
  }
  const fresh = [];
  for (const [rel, list] of byFile) {
    const allowed = known.get(rel)?.count ?? 0;
    if (list.length > allowed) fresh.push(...list.map((h) => ({ ...h, allowed, total: list.length })));
  }
  const drifted = [];
  for (const [rel, entry] of known) {
    const n = byFile.get(rel)?.length ?? 0;
    if (n < entry.count) drifted.push({ rel, was: entry.count, now: n, fix: entry.fix });
  }
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  return { fresh, drifted };
}

const one = ratchet(found.filter((h) => h.kind === 'error'), KNOWN);
const two = ratchet(found.filter((h) => h.kind === 'count'), KNOWN_COUNT);

let failed = false;

if (one.fresh.length) {
  failed = true;
  const n = one.fresh.length;
  console.error(`\n${n} write${n === 1 ? '' : 's'} whose success is inferred rather than counted:\n`);
  for (const h of one.fresh) {
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: the ${h.verb} resolves whether or not the database accepted it — supabase-js sets \`error\` and does NOT throw, so this statement cannot tell a saved row from a refused one, and neither can the screen above it`);
    if (h.verb === 'update' || h.verb === 'delete') {
      // Reading `error` is the remedy for an insert and is NOT the remedy here,
      // and saying so used to be this message's one inaccuracy: a zero-row
      // update is a 204 with a null error, so the suggested fix would have left
      // the site passing both rules and still unable to tell.
      console.error(`    right: COUNT it — a ${h.verb} that matches no rows is a 204 with a null`);
      console.error("           error, so reading `error` alone cannot see it. Either");
      console.error("           `{ count: 'exact' }` and read the count (src/lib/wroteRows.ts turns it");
      console.error("           into a sentence), or `.select('id')` and check the length");
    } else {
      console.error('    right: bind it and read `error` (`const { error } = await …`), or count it');
      console.error("           (`{ count: 'exact' }`, `.select('id')`), or inspect it in place");
      console.error('           (`.then(({ error }) => …)`) — see src/ui/coachProfile.tsx for a two-write');
      console.error('           save that names WHICH half did not land');
    }
    console.error('');
    if (h.allowed) console.error(`    (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})\n`);
  }
  console.error('A read that fails shows the reader nothing. A write that fails shows them exactly');
  console.error('what they typed, sitting there, apparently saved. If the failure genuinely does');
  console.error('not matter, say so with the marker check-reads.mjs already uses:');
  console.error('`no-error-ok: <why a write that did nothing is survivable here>`.\n');
}

if (two.fresh.length) {
  failed = true;
  const n = two.fresh.length;
  console.error(`\n${n} update${n === 1 ? '' : 's'}/delete${n === 1 ? '' : 's'} whose ROW COUNT is never read:\n`);
  for (const h of two.fresh) {
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    const an = h.verb === 'update' ? 'an' : 'a';
    console.error(`    wrong: \`error\` is read here, and on ${an} ${h.verb} that is not the question.`);
    console.error(`           ${an.replace(/^a/, 'A')} ${h.verb} that matches ZERO rows is not an error — it is a 204 with a`);
    console.error('           null error and a null body, identical to one that changed everything');
    console.error('           it was asked to. An RLS policy refusing it, the row having been');
    console.error('           removed by somebody else, or a stale id from a list drawn before the');
    console.error('           last refresh all arrive here as success');
    console.error("    right: `{ count: 'exact' }` in the options and read the count — pass the");
    console.error('           result to `writeFailure`/`assertWrote` in src/lib/wroteRows.ts, which');
    console.error('           already distinguishes refused, matched-nothing and never-counted and');
    console.error("           says each in words — or `.select('id')` and test the length");
    console.error('');
    if (h.allowed) console.error(`    (${h.rel} is on the count ratchet at ${h.allowed}; it now has ${h.total})\n`);
  }
  console.error('This is the bug src/lib/wroteRows.ts was written for, and it has shipped twice.');
  console.error('A settlement write returned 204 with a null error having stamped zero sessions,');
  console.error('and the payroll run reported itself paid while every session stayed payable.');
  console.error('If matching nothing is genuinely the outcome somebody asked for — clearing a');
  console.error('mark that was never set, deleting nights a device never recorded — say so:');
  console.error('`no-count-ok: <why zero rows is the right answer here>`.\n');
}

for (const [label, d] of [['', one.drifted], ['count ', two.drifted]]) {
  if (!d.length) continue;
  failed = true;
  console.error(`\n${d.length} ${label}ratchet entr${d.length === 1 ? 'y is' : 'ies are'} out of date — the backlog has shrunk and the list has not:\n`);
  for (const e of d) {
    console.error(`  ${e.rel}: listed at ${e.was}, now ${e.now}. ${e.now === 0 ? 'Delete the entry.' : `Lower the count to ${e.now}.`}`);
    console.error(`    ${e.fix}\n`);
  }
  console.error('A list that over-states what is wrong is how a ratchet turns into an ignore');
  console.error('list. The number comes down with the work.\n');
}

if (failed) process.exit(1);

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
const counted = [...KNOWN_COUNT.values()].reduce((n, e) => n + e.count, 0);
console.log(
  `check-writes — ok, ${files.length} files across the apps and the console; `
  + `${examined} supabase mutation chains examined, of which ${updateOrDelete} are updates or deletes; `
  + `no new uncounted write${backlog ? `, ${backlog} known and ratcheted` : ''}`
  + `${counted ? `, ${counted} uncounted update${counted === 1 ? '' : 's'}/delete${counted === 1 ? '' : 's'} ratcheted in another lane's files` : ''}`,
);
