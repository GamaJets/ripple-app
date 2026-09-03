#!/usr/bin/env node
// "The read did not fail" is not the same claim as "this is all of it".
//
// ── the most repeated defect in this codebase ─────────────────────────────
//
// src/ui/loadStatus.ts gives every provider four answers — 'loading', 'ready',
// 'partial', 'error' — and its header explains at length why 'partial' is
// deliberately not 'ready'. It also exports the one function a screen is
// supposed to gate a figure on:
//
//     export const isWhole = (s: LoadStatus): boolean => s === 'ready';
//
// It is written as a function rather than left to each screen's own comparison
// precisely because the comparison people reach for is `status !== 'error'`,
// and that admits BOTH of the other two answers:
//
//   'loading' — nothing has come back yet. The list is `[]` because the read is
//               still in flight, and a screen gated this way prints "You have
//               no clients" to a coach with forty, for as long as the read
//               takes. On a gym network that is not a flicker.
//   'partial' — the read came back at PostgREST's 1000-row ceiling (see
//               src/lib/rowCap.ts). The rows are real; the SET is a prefix. A
//               total, a count or an average over it is a figure computed from
//               an unknown fraction, rendered as fact.
//
// The comments this tree already carries are the evidence that it keeps
// happening: app/(client)/dashboard.tsx, app/(client)/calendar.tsx (twice, in
// one expression), app/(client)/membership.tsx, app/(client)/cards.tsx,
// app/(client)/compare.tsx, app/(trainer)/client-week.tsx,
// app/(trainer)/leaderboard.tsx, app/(trainer)/client-attendance.tsx,
// app/(trainer)/client-training.tsx, app/(owner)/dashboard.tsx,
// app/(owner)/revenue.tsx, app/(owner)/trainers.tsx, app/(owner)/growth.tsx and
// app/(owner)/promotions.tsx each carry a written note saying "`isWhole`, not
// `!== 'error'`" and explaining what it cost. Fourteen files. It is the single
// most repeated defect in this codebase and it has been fixed by hand fourteen
// times.
//
// ── why this gate is much narrower than "flag `!== 'error'`" ──────────────
//
// Because `status !== 'error'` is not always wrong, and a gate that said it was
// would be wrong about a dozen honest lines on its first run. There are real,
// correct uses in this tree right now:
//
//   · app/(trainer)/calendar.tsx keeps the previous calendar link unless the
//     read FAILED, so that "we could not ask" never renders as "you have not
//     connected". The question there really is "did it fail", and 'partial'
//     and 'loading' genuinely do not change the answer.
//   · app/(trainer)/library.tsx and app/(trainer)/videos.tsx use it to decide
//     whether to draw a "we could not read your clips" notice at all — the
//     error case has its own separate branch immediately underneath.
//   · src/lib/intakeSeed.ts uses it to choose between a stand-in and a real
//     document, and the comment above it argues that 'partial' and 'ready' are
//     equally good there, which they are.
//
// So the gate does not look at the comparison. It looks at the comparison
// TOGETHER WITH THE CLAIM BEING MADE, and only fires on two shapes where the
// claim cannot survive 'loading' or 'partial' under any reading:
//
//   RULE 1 — an assertion of EMPTINESS gated on `!== 'error'`.
//     `{r.roster.length === 0 && r.status !== 'error' ? <Empty/> : null}`
//     Under 'loading' the roster is `[]` because nothing has arrived, and the
//     screen tells a coach with forty clients that they have none. This is the
//     same defect check-reads.mjs exists for, one level up: there it is a read
//     that cannot tell failure from emptiness, here it is a SCREEN that cannot.
//     Note that the opposite direction — `status !== 'error' && list.length` —
//     is NOT flagged: showing rows that really exist is fine under 'partial',
//     and three of those in app/(trainer)/payments.tsx are honest.
//
//   RULE 2 — an expression that rules out 'error' AND 'loading' and stops
//     there. `logStatus !== 'error' && logStatus !== 'loading'` is somebody
//     enumerating the bad statuses and missing the third, which is exactly
//     what the note in app/(client)/compare.tsx describes: "admits 'partial'
//     … under it a scan that fell off the end of a truncated read". If you are
//     going to enumerate, the enumeration is `isWhole`.
//
// ── why a gate and not a fix ──────────────────────────────────────────────
//
// Fourteen hand-fixes did not hold the line, and the reason is structural: the
// wrong form is SHORTER than the right one, reads as more explicit, and passes
// every other check here. Nothing about `status !== 'error'` looks like an
// omission. It looks like somebody who thought about failure — which they did.
// They thought about one of the three ways a screen can be asked to state
// something it does not know.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// Mark the line, or the comment run immediately above it, with a reason:
//
//     // whole-ok: 'partial' cannot occur here — this provider never truncates,
//     // it holds one row — and under 'loading' the branch below draws a spinner
//
// The sentence is the point, exactly as with `no-error-ok:` in check-reads.mjs
// and `rtl-ok:` in check-rtl.mjs. Writing it means naming what 'loading' and
// 'partial' would do to the sentence on the screen, which is the thought that
// was skipped all fourteen times.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Where LoadStatus is consumed: the three phone apps, the shared providers and
 *  the console. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * A ratchet, not an ignore list, on the terms `KNOWN` sets out in
 * check-dead-exports.mjs: listed at 1, fails at 2; a count that has dropped
 * fails too, so the list can only shrink. Every entry is open work in a file
 * this lane does not own, and none was silenced with a `whole-ok:` marker,
 * because a gate's author annotating other people's code is how a rule gets
 * weakened by the person least placed to judge it.
 *
 * The six identical roster lines were one edit repeated six times and were
 * taken as one job: `r.roster.length === 0 && isWhole(r.status)`.
 *
 * All ten are now cleared and the ratchet is empty. Five of the six roster
 * lines took the edit. log-session.tsx did not, and the reason is worth keeping
 * here: it was the only one of the six that had already split 'loading' out
 * INSIDE the branch and drawn "Reading your clients…" for it, so the sentence
 * the rule exists to prevent was never reachable there. Of the four rule-2
 * entries, three turned out to admit 'partial' on purpose — consistency.tsx
 * gates its all-time totals on a separate `isWhole`, client.tsx reads one field
 * off one named client's own row, and planVsActual.ts ANDs `landed` with a
 * window check that answers 'partial' more precisely than `isWhole` could.
 * Those four carry written `whole-ok:` reasons instead of edits. The header's
 * point stands: the sentence was the work, in all ten cases.
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

/** A line that is prose. Fourteen files here quote the wrong form in a comment
 *  explaining that they stopped doing it. */
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

/** `<something> !== 'error'`, capturing what is being compared. */
const NOT_ERROR = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*!==\s*'error'/g;

/**
 * An assertion that a list is EMPTY. Only these three: `=== 0`, `< 1`, and a
 * bare `!list.length`. Deliberately not `!== 0` or a bare `.length` — those
 * mean "there are some", and showing rows that genuinely exist is honest under
 * 'partial'.
 */
const CLAIMS_EMPTY = /\.length\s*===\s*0|\.length\s*<\s*1|![A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\.length\b/;

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
assertRootFloors('check:whole', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check.
if (files.length < 150) {
  console.error(`check-whole: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    NOT_ERROR.lastIndex = 0;
    let m;
    const seen = new Set();
    while ((m = NOT_ERROR.exec(line))) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rulesOutLoading = new RegExp(esc + "\\s*!==\\s*'loading'").test(line);
      const rulesOutPartial = new RegExp(esc + "\\s*!==\\s*'partial'").test(line);

      let rule = null;
      if (rulesOutLoading && !rulesOutPartial) {
        rule = {
          n: 2,
          wrong: `\`${id}\` is ruled out of 'error' and 'loading' and left free to be 'partial' — a read that came back at PostgREST's 1000-row ceiling, whose rows are real and whose SET is a prefix`,
        };
      } else if (!rulesOutLoading && CLAIMS_EMPTY.test(line)) {
        rule = {
          n: 1,
          wrong: `an assertion that a list is EMPTY, gated on \`${id} !== 'error'\` — which is true while the read is still in flight, so the list is \`[]\` because nothing has arrived and the screen says so out loud`,
        };
      }
      if (!rule) continue;
      if (markedAbove(lines, i + 1, /whole-ok:\s*\S/)) continue;
      found.push({
        rel, line: i + 1, rule: rule.n, wrong: rule.wrong,
        text: line.trim().slice(0, 110),
      });
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
  console.error(`\n${fresh.length} screen gate${fresh.length === 1 ? '' : 's'} that mistake "the read did not fail" for "this is all of it":\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}   (rule ${h.rule})`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: ${h.wrong}`);
    console.error("    right: isWhole(status) from src/ui/loadStatus.ts — 'ready' and only 'ready',");
    console.error('           which is the one condition under which a screen may count, sum,');
    console.error('           average, or say that something is empty');
    if (h.allowed) console.error(`    (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error('');
  }
  console.error('src/ui/loadStatus.ts exports `isWhole` for exactly this, and its header says why');
  console.error("'partial' is deliberately not 'ready'. If 'loading' and 'partial' genuinely");
  console.error('cannot reach this line, say which and why: `whole-ok: <reason>`.\n');
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
console.log(`check-whole — ok, ${files.length} files; no new figure or empty-state gated on "did not fail"${backlog ? `, ${backlog} known and ratcheted` : ''}`);
