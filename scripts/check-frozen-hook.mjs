#!/usr/bin/env node
// A clock that stopped when the screen opened — the half with a full dependency
// list.
//
// ── why this is a second file and not a third rule in check-frozen-day ────
//
// scripts/check-frozen-day.mjs catches
//
//     const today = useMemo(() => todayKey(), []);
//
// an EMPTY dependency array. That gate is right about everything except its
// scope, and five separate defects found in one night were all the same
// mistake wearing the shape it cannot see:
//
//     const history = useMemo(() => pastSessions(all ?? []), [all]);
//
// A dependency list with entries in it. React re-runs the memo when those
// entries move, and `all` moves when the SERVER answers — never when time
// passes. So the clock read in the body is pinned to the last read, and on
// this project most of these screens are tabs registered `href: null` in a
// `_layout.tsx`, which means they mount once and are never unmounted, not even
// by backgrounding the app. A full dependency list looks diligent. It is the
// same frozen value with a longer line.
//
// The five, all now fixed, and what each cost:
//
//   · src/ui/clientWeek.ts — which week of their block a member is on, keyed
//     `[program, on]`. Six client screens read it and none is ever unmounted,
//     so the block's week stopped advancing at the member's first app open.
//     They do the wrong session and every screen agrees with the wrong answer.
//   · src/ui/readiness.ts — a two-day training window pinned to first open, so
//     a session four days old went on suppressing readiness.
//   · app/(client)/bookings.tsx — a class that finished six hours ago stayed
//     under "Upcoming" with a live Cancel button, which can cost a member a
//     late-cancellation fee for a session they took.
//   · app/(client)/pt-sessions.tsx — the UNDER-including direction, which is
//     worse: a session recorded after the screen was opened never appeared
//     under "Awaiting Your Approval", so the member could not see what their
//     coach had logged and could not dispute it. Silence reads as approval.
//   · app/(client)/membership.tsx — "Sessions Logged This Month" from a
//     `new Date()` in a memo keyed `[log]`.
//
// ── the half nobody could see at the call site ────────────────────────────
//
// 121 functions under src/lib take the clock as a DEFAULTED parameter:
//
//     export function pastSessions<T>(rows: T[], now: number = Date.now()): T[]
//
// which is the right shape for the library — it is what makes the rule
// testable under six timezones without a device. But at the call site there is
// no clock to see. `pastSessions(all ?? [])` contains no `Date`, no `now`, no
// `today`; a reviewer reading that line has nothing to notice. Eight of the
// hits this gate found on its first run were of exactly that form, including
// the second frozen memo on app/(client)/pt-sessions.tsx — the same file, one
// screen apart from the one that had already been fixed by hand.
//
// So this gate reads src/lib first, works out which exported functions default
// a parameter to `Date.now()` or `new Date()` and at which position, and then
// counts the arguments at every call inside a memo. A call that stops short of
// the clock parameter is reading the clock, and the gate says so with the
// signature it came from.
//
// ── what counts as a dependency that unfreezes it ─────────────────────────
//
// Not a name. Names are guesses, and a gate that guesses is a gate people
// argue with. A dependency unfreezes the memo when it is a value this FILE
// derives from a clock: something assigned from `useToday()` or `useNow()`
// (src/ui/today.ts), or from a direct clock read in a plain declaration. A
// `useState`/`useRef` initialiser is deliberately excluded — `const [start] =
// useState(Date.now())` is frozen by construction and depending on it is the
// bug, not the fix.
//
// ── useMemo only, and why not useEffect or useCallback ────────────────────
//
// A `useCallback` body runs when the callback is CALLED, so its clock read is
// fresh however stale the dependency list is: `const load = useCallback(async
// () => { …windowStart(31)… }, [uid])` is correct, and the first draft of this
// scan reported forty of them. A `useEffect` body runs on the deps and is
// usually stamping something that has just happened — `if (status === 'ready')
// setFetchedAt(Date.now())` is right, and there were thirty of those. Both
// classes are honest, both are common, and a gate that reported them would be
// deleted within a week. `useMemo` is the one whose whole purpose is to NOT
// re-run, which is what makes a clock inside it a contradiction.
//
// ── false positives that are not bugs ─────────────────────────────────────
//
// Two shapes were judged honest during this gate's first sweep and both come
// out clean without an exception, which is the test of whether the rule is
// drawn in the right place:
//
//   · a memo whose LABEL and DATA both derive from the same frozen value. The
//     analytics and invites consoles freeze `Date.now()` deliberately so that
//     a table somebody is reading cannot change underneath them, and the
//     heading says which period it is. Those are `useState` with no setter and
//     are check-frozen-day's business, not this file's.
//   · a value the user NAVIGATES — a month offset, a chosen week. Where the
//     base was derived from a clock read in the render body and carried into
//     the deps, this gate sees the clock in the dependency and stays quiet.
//     studio-web/app/timetable/page.tsx is that case: `weekOpened` comes from
//     `startOfWeek()` in the render body and is a dependency, so the memo under
//     it re-runs whenever the page redraws with a different week.
//
// Anything genuinely wanting the instant it opened on says so on the line, or
// in the unbroken run of comment lines immediately above it:
//
//     // frozen-day-ok: this stamps the export with the day it was TAKEN, and a
//     // stamp that moved after the fact would be a different claim
//
// The same marker as check-frozen-day.mjs, on purpose: one sentence for a
// reviewer to read, one convention to learn, whichever of the two gates fired.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere a React component is written. The console is included for the
 *  reason check-frozen-day gives: its pages are left open on a front desk for
 *  days, which is the same failure with a longer fuse. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/** Where the library lives. Read first, for the defaulted-parameter map. */
const LIB = 'src/lib';

/* ── source hygiene, shared with check-frozen-day ─────────────────────────── */

/**
 * The source with every comment and string body replaced by spaces of the same
 * length, so offsets, line numbers and bracket balance are all unchanged.
 *
 * Not fastidiousness: every file this gate names quotes the WRONG form in its
 * own comment explaining what it stopped doing, so a scanner that reads
 * comments reports the fix as the bug. And blanking comments naively, by
 * looking for `//`, eats the `//` in a URL inside a string and takes the rest
 * of the line's real code with it.
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

/** The balanced text of a call starting at `open` (the index of its `(`). */
function callText(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return null;
}

/** An argument or parameter list split on its TOP-LEVEL commas. A naive
 *  `split(',')` cuts `foo(a, { x: 1, y: 2 })` into three, which would move
 *  every parameter after an object literal and mis-count every call. */
function splitArgs(inner) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  const last = inner.slice(start);
  if (parts.length || last.trim()) parts.push(last);
  return parts;
}

/**
 * Does a marker apply to `line` (1-based)?
 *
 * On the line itself, or anywhere in the unbroken run of comment and blank
 * lines immediately above it. It has to be allowed above the line because a
 * `//` inside JSX renders as two slashes on somebody's screen, but it is a RUN
 * and not a window of N lines, so an annotation can never drift down and excuse
 * the statement after the one it was written for.
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
 * Reading the clock, with NO argument.
 *
 * The argument matters and check-frozen-day does not need it: under an empty
 * dependency array nothing is in scope to pass, so `new Date(` is safe to
 * match. Here it is not — `new Date(row.startsAt)` is on hundreds of lines and
 * reads a row, not a clock. Only the no-argument forms are the clock.
 */
const READS_CLOCK = /\bDate\s*\.\s*now\s*\(\s*\)|new\s+Date\s*\(\s*\)|\btodayKey\s*\(\s*\)|\bstartOfWeek\s*\(\s*\)|\bweekStartIso\s*\(\s*\)/;

/** A parameter whose default IS the clock. The library shape this gate follows. */
const CLOCK_DEFAULT = /=\s*(?:Date\s*\.\s*now\s*\(\s*\)|new\s+Date\s*\(\s*\))/;

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * A ratchet on the terms `KNOWN` sets out in check-dead-exports.mjs: a file
 * listed at 1 fails the build at 2, so the list can only grow shorter.
 *
 * ONE deliberate difference from check-frozen-day.mjs, and it is about who is
 * holding the file. That gate treats a count that has DROPPED as a failure,
 * because an over-stated ratchet is how a ratchet becomes an ignore list. Every
 * entry below is in another lane's territory and several are being edited
 * tonight, so a drop here is somebody doing the work — and failing their build
 * for it is how a gate gets a `--force` written next to it. A drop prints and
 * passes. Lower the number when you see the line.
 *
 * ── EMPTY, AND THAT IS THE POINT ──────────────────────────────────────────
 *
 * All eighteen have been fixed. The last four were app/(trainer)/sessions.tsx
 * (two: `pastSessions` and `windowStart`, so a session that ended while the
 * screen was open never joined the record), client-training.tsx (`historySpan`,
 * so how long a client had been training stopped growing when the read landed),
 * client-nutrition.tsx (`energyPlanFor`, so a goal deadline stopped counting
 * down and the calorie target derived from it drifted with it) and
 * share-kit.tsx (both bounds of the window a coach PUBLISHES a session count
 * over).
 *
 * With nothing left to ratchet this gate is in `check:all`, which is what its
 * package.json note said it was waiting for. Anything added below is a
 * regression with a name, not a backlog — the header above says why the shape
 * is invisible to check:frozen-day, and the fix is always the same two lines.
 */
const KNOWN = new Map([
]);

/* ── which library functions read the clock from a defaulted parameter ────── */

const libFiles = walk(join(ROOT, LIB));
if (libFiles.length < 200) {
  console.error(`check-frozen-hook: only found ${libFiles.length} files under ${LIB}, which cannot be right. Refusing to pass.`);
  process.exit(1);
}

/** exported name → { idx, from } — the position of its first clock-defaulted
 *  parameter, and the file it was declared in, so the message can cite it. */
const CLOCKY = new Map();
for (const f of libFiles) {
  const src = blank(readFileSync(f, 'utf8'));
  const rel = relative(ROOT, f);
  const DECL = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(|export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = DECL.exec(src))) {
    const name = m[1] || m[2];
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const text = callText(src, open);
    if (!text) continue;
    const idx = splitArgs(text.slice(1, -1)).findIndex((a) => CLOCK_DEFAULT.test(a));
    if (idx >= 0 && !CLOCKY.has(name)) CLOCKY.set(name, { idx, from: rel });
  }
}

if (CLOCKY.size < 40) {
  console.error(`check-frozen-hook: found only ${CLOCKY.size} library functions that default a clock argument. `
    + 'That map is how this gate sees a frozen memo with no `Date` on the line, so an empty one would '
    + 'pass every such file silently. Refusing to pass.');
  process.exit(1);
}

/* ── the sweep ────────────────────────────────────────────────────────────── */

const files = [];
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  walk(join(ROOT, r), files);
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:frozen-hook', perRoot);

if (files.length < 150) {
  console.error(`check-frozen-hook: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = blank(raw);
  const rel = relative(ROOT, f);
  const rawLines = raw.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  /* Which identifiers in THIS file carry a clock. Derived, not guessed: see the
   * header. `useState`/`useRef` initialisers are excluded because a value
   * frozen by construction is the defect, not the cure. */
  const clockIds = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    const init = m[2];
    if (/\buse(?:State|Ref)\s*\(/.test(init)) continue;
    if (/\buse(?:Today|Now)\s*\(/.test(init) || READS_CLOCK.test(init)) clockIds.add(m[1]);
  }

  const HOOK = /\buseMemo\s*(<[^;{}()]*>)?\s*\(/g;
  let m;
  while ((m = HOOK.exec(src))) {
    const open = m.index + m[0].length - 1;
    const text = callText(src, open);
    if (!text) continue;

    // The dependency array, allowing the trailing comma this tree writes on a
    // multi-line call. Without the `,?` a memo written
    //     useMemo(() => f(x), [x],)
    // matches nothing at all and is invisible — which is how the second frozen
    // memo on src/ui/deviceHrv.ts survived the first draft of this scan.
    const dm = text.match(/,\s*\[([\s\S]*)\]\s*,?\s*\)$/);
    if (!dm) continue;
    const deps = dm[1];
    if (!deps.trim()) continue;          // empty deps — check-frozen-day's rule 1
    const body = text.slice(0, text.length - dm[0].length);

    const why = [];
    if (READS_CLOCK.test(body)) why.push('a clock read in the memo body');
    for (const [name, info] of CLOCKY) {
      const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
      let cm;
      while ((cm = re.exec(body))) {
        const o = body.indexOf('(', cm.index + name.length);
        const t2 = callText(body, o);
        if (!t2) continue;
        const n = splitArgs(t2.slice(1, -1)).filter((x) => x.trim()).length;
        if (n <= info.idx) {
          why.push(`\`${name}(…)\` called with ${n} argument${n === 1 ? '' : 's'}, so its argument ${info.idx} falls back to the clock (${info.from})`);
        }
      }
    }
    if (!why.length) continue;

    let unfrozen = READS_CLOCK.test(deps);
    for (const d of deps.matchAll(/[A-Za-z_$][\w$]*/g)) if (clockIds.has(d[0])) unfrozen = true;
    if (unfrozen) continue;

    const line = lineOf(m.index);
    if (markedAbove(rawLines, line, /frozen-day-ok:\s*\S/)) continue;

    found.push({
      rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      deps: deps.replace(/\s+/g, ' ').trim().slice(0, 90),
      why: [...new Set(why)],
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

if (fresh.length) {
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${fresh.length} memo${fresh.length === 1 ? '' : 's'} reading a clock that its dependencies cannot move:\n`);
  for (const h of fresh) {
    if (h.allowed) console.error(`  (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    deps: [${h.deps}]`);
    for (const w of h.why) console.error(`    clock: ${w}`);
    console.error('    wrong: none of those dependencies changes when time does, so this value is fixed');
    console.error('           at the last read — and these screens are tabs that never unmount.');
    console.error('    right: take the instant from `useNow()` (or the day from `useToday()`) in');
    console.error('           src/ui/today.ts, pass it in, and put it IN the dependency list, where a');
    console.error('           reviewer can see it. If the value genuinely must not move, say so:');
    console.error('           `// frozen-day-ok: <why the moment it opened is the right one>`\n');
  }
  console.error('A member could not see the session their coach had logged this afternoon, because');
  console.error('the list deciding what had already happened was still asking this morning\'s');
  console.error('question — and silence downstream reads as approval. src/ui/today.ts is the answer.\n');
  process.exit(1);
}

/* A ratchet entry that went quiet is either somebody's work or a scan that
 * never opened the file, and those two must not print the same sentence.
 *
 * assertRootFloors cannot tell them apart on its own: it checks the roots a
 * gate NAMES, so deleting `'app'` from ROOTS above leaves nothing to be short
 * and every hit under app/ disappears with the gate still saying ok. That is
 * not hypothetical — it is the failure gate-floor.mjs's own header describes,
 * one level up. So a KNOWN file that is still on disk and was NOT among the
 * files walked is a hole in the sweep, and it is fatal. */
const scanned = new Set(files.map((f) => relative(ROOT, f)));
const unscanned = [];
const drifted = [];
for (const [rel, entry] of KNOWN) {
  const n = byFile.get(rel)?.length ?? 0;
  if (n >= entry.count) continue;
  let onDisk = true;
  try { statSync(join(ROOT, rel)); } catch { onDisk = false; }
  if (onDisk && !scanned.has(rel)) unscanned.push(rel);
  else drifted.push({ rel, was: entry.count, now: n });
}

if (unscanned.length) {
  console.error('\ncheck-frozen-hook: files this gate is tracking exist on disk and were never '
    + 'opened, so its "ok" would be a claim about a tree it did not walk:\n');
  for (const rel of unscanned) console.error(`  ${rel}`);
  console.error('\nA root has been renamed, moved, or dropped from ROOTS at the top of this file.\n');
  process.exit(1);
}

for (const d of drifted) {
  console.log(`check-frozen-hook — ${d.rel} is listed at ${d.was} and now has ${d.now}. `
    + `${d.now === 0 ? 'Delete its entry.' : `Lower its count to ${d.now}.`}`);
}

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(`check-frozen-hook — ok, ${files.length} files, ${CLOCKY.size} clock-defaulting library functions`
  + `${backlog ? `; ${backlog} known and ratcheted` : ''}`);
