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

    // Is the value going anywhere? Anything that binds, returns, or passes it
    // along means somebody downstream can read `error`.
    const head = before(src, start);
    const w = head.word;
    if (w === 'return' || w === 'yield') continue;
    if (head.two === '=>' || head.two === '&&' || head.two === '||' || head.two === '??') continue;
    if ('=(,[:?+'.includes(head.ch)) continue;

    // Is it being inspected in place?
    if (/\.then\s*\(/.test(stmt)) continue;
    if (/\.select\s*\(/.test(stmt)) continue;
    if (/count\s*:\s*['"]exact['"]/.test(rawStmt)) continue;

    const line = src.slice(0, start).split('\n').length;
    if (markedAbove(rawLines, line, /no-error-ok:\s*\S/)) continue;

    const verb = (MUTATES.exec(stmt) || [, 'write'])[1];
    found.push({
      rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      verb,
    });
  }
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
  console.error(`\n${fresh.length} write${fresh.length === 1 ? '' : 's'} whose success is inferred rather than counted:\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: the ${h.verb} resolves whether or not the database accepted it — supabase-js sets \`error\` and does NOT throw, so this statement cannot tell a saved row from a refused one, and neither can the screen above it`);
    console.error('    right: bind it and read `error` (`const { error } = await …`), or count it');
    console.error("           (`{ count: 'exact' }`, `.select('id')`), or inspect it in place");
    console.error('           (`.then(({ error }) => …)`) — see src/ui/coachProfile.tsx for a two-write');
    console.error('           save that names WHICH half did not land\n');
    if (h.allowed) console.error(`    (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})\n`);
  }
  console.error('A read that fails shows the reader nothing. A write that fails shows them exactly');
  console.error('what they typed, sitting there, apparently saved. If the failure genuinely does');
  console.error('not matter, say so with the marker check-reads.mjs already uses:');
  console.error('`no-error-ok: <why a write that did nothing is survivable here>`.\n');
  process.exit(1);
}

if (drifted.length) {
  console.error(`\n${drifted.length} ratchet entr${drifted.length === 1 ? 'y is' : 'ies are'} out of date — the backlog has shrunk and the list has not:\n`);
  for (const d of drifted) {
    console.error(`  ${d.rel}: listed at ${d.was}, now ${d.now}. ${d.now === 0 ? 'Delete the entry.' : `Lower the count to ${d.now}.`}`);
    console.error(`    ${d.fix}\n`);
  }
  console.error('A list that over-states what is wrong is how a ratchet turns into an ignore');
  console.error('list. The number comes down with the work.\n');
  process.exit(1);
}

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(`check-writes — ok, ${files.length} files across the apps and the console; no new uncounted write${backlog ? `, ${backlog} known and ratcheted` : ''}`);
