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
//   RULE 1 — a CLAIM ABOUT A SET gated on `!== 'error'`. Two shapes.
//
//     1a — an assertion of EMPTINESS.
//     `{r.roster.length === 0 && r.status !== 'error' ? <Empty/> : null}`
//     Under 'loading' the roster is `[]` because nothing has arrived, and the
//     screen tells a coach with forty clients that they have none. This is the
//     same defect check-reads.mjs exists for, one level up: there it is a read
//     that cannot tell failure from emptiness, here it is a SCREEN that cannot.
//     Note that the opposite direction — `status !== 'error' && list.length` —
//     is NOT flagged: showing rows that really exist is fine under 'partial',
//     and three of those in app/(trainer)/payments.tsx are honest.
//
//     1b — a FIGURE. See the next section; it is the reason this file was
//     reopened.
//
// ── 1b, and the morning it was logged with no signal ──────────────────────
//
// Everything above pairs `!== 'error'` with an EMPTINESS assertion, and that is
// all rule 1 could ever see. So it could not see a COUNT — because a count
// matches none of the emptiness patterns. It matches the opposite of them.
//
// app/(trainer)/my-training.tsx carried exactly that. Every KPI on the screen
// was gated on `whole` (`isWhole(status)`); forty lines further down, one line
// was not:
//
//     <SectionHead title="Today" note={known && today ? `${today.entries.length}` : undefined} />
//
// where, at the top of the same component,
//
//     const known = status !== 'error';
//
// `check:whole` was run against that line before it was fixed and printed `ok`.
// Twice over: the claim was a count and not an emptiness, and the comparison
// was not even on the line — it was on line 163, bound to a name, and used on
// line 784.
//
// Why it matters on THIS screen rather than as a general tidiness point:
// `useWorkoutLog` reaches 'partial' by two routes, and the second is
//
//     setQueueStatus(queueRead ? 'ready' : 'partial')   src/ui/workoutLog.tsx:314
//
// — the on-device QUEUE FILE could not be parsed. A truncated server page is
// newest-first, so a server-side 'partial' keeps today's rows; the queue file is
// the other route, and the entries in it are precisely the ones logged with no
// signal, which on a coach's own training screen is this morning's, in a
// basement. So "Today · 3" was three out of a number the screen did not have,
// printed in the typeface of an exact figure.
//
// ── what a FIGURE is, and what a LIST is ──────────────────────────────────
//
// The hard part of 1b is not finding counts. It is not firing on the honest
// ones, and there are three kinds a screen draws over a short read:
//
//   · a COUNT or a SUM presented as a fact — "Today · 3", "£4,210 this month".
//     This needs a whole read and nothing less. It is 1b.
//   · a LIST being rendered. A partial read may be SHOWN; it may not be
//     COUNTED. Rows in hand are real rows. Lane 85's own fix kept the entries
//     listing under 'partial' and withheld only the number above it, and that
//     is the house position — `PartialRead` at the top of the screen has
//     already said the set is short. `.map(`, `<FlatList data={…}`, and
//     `status !== 'error' && list.length ? <rows/> : null` are all this, and
//     none of them is flagged.
//   · a count of what the screen genuinely has IN HAND, beside a stated
//     truncation — "showing 20 of many". That is not a claim about the set, it
//     is a claim about the page, and it is correct. This gate CANNOT tell it
//     apart from 1b, and does not try: it fires, and the line takes a
//     `whole-ok:` reason saying the truncation is stated. That is the honest
//     trade, and it is the same one rule 2 makes thirteen times above.
//
// So 1b matches two spellings and only two, both of which are a number being
// produced rather than a set being tested:
//
//   · a COUNT CLOSING A HOLE — `.length` immediately followed by `}`. That is
//     `${rows.length}` in a template literal and `{rows.length}` as a JSX child
//     or prop. It is the count being HANDED TO THE READER. Deliberately not
//     `.length ?`, `.length &&`, `.length > 0`, `.length === 0` or
//     `.length - 1`: those are tests and arithmetic, and `disputes.length ?` in
//     app/(trainer)/payments.tsx:2002 is the honest list-render above.
//   · an ARITHMETIC FOLD — `.reduce(` and a `, 0)` seed on the same line. A
//     fold seeded with a number is a total; a fold seeded with `new Map()` or
//     `[]` is a regroup and is not a claim. 202 of the 207 single-line reduces
//     in this tree seed with `0`, so the seed is a reliable tell and not a
//     guess.
//
// ── the gate has to be GATING, not merely present ─────────────────────────
//
// app/(trainer)/calendar.tsx:700 is why this is a rule and not an `&&` of two
// greps:
//
//     known, hasWeekly: weeklyFromSlots(availStatus, availSlots.length), clientsOnBook,
//
// `known` and a `.length` on one line, and `known` is not gating anything — it
// is a field in an object literal, and the length is an argument to a function
// that takes the status as its other argument and decides for itself. A rule
// that fired on co-occurrence would call that a defect on its first run.
//
// So 1b requires the gate to stand BEFORE the figure and to be joined to it as
// a condition: an `&&`, or a ternary `?`, in the text between them (`?.` and
// `??` do not count — they are not gates). `known && today ? `${…length}`` has
// it. Line 700 does not.
//
// ── the name, not just the comparison ─────────────────────────────────────
//
// 1b resolves ONE indirection, because without it the rule cannot reach the line
// it was written for. A `const` whose entire right-hand side is the comparison —
//
//     const known = status !== 'error';
//     const logKnown = logStatus !== 'error';
//     const weighKnown = ci.status !== 'error';
//
// — is a NAME FOR THE WEAK GATE, and using the name is using the gate. Eight of
// these exist in this tree, in seven files. Nothing else is followed: the whole
// RHS must be that one comparison and nothing more, so
// `const stated = i.policyStatus !== 'error' && !!i.policy;` in
// src/lib/cancelDeadline.ts and `const landed = input.log != null && …` in
// src/lib/planVsActual.ts are NOT aliases here. They are weak too, in their own
// way, but a rule that starts following compound expressions is a rule that has
// started guessing, and rule 2 already reads both of those lines directly.
//
// The mirror of it is the exemption. `const whole = isWhole(fl.status);` is a
// name for the RIGHT gate, and a figure line carrying `isWhole(` or one of
// those names is satisfied and not flagged. app/(trainer)/my-nutrition.tsx:791
// is the sibling of Lane 85's line and was always correct —
//
//     note={known && whole && fl.entries.length ? `${fl.entries.length}` : undefined}
//
// — `known` is on it, a count is on it, and `whole` is what decides. Flagging
// that would be flagging the fix.
//
//   RULE 2 — an expression that rules out 'error' AND 'loading' and stops
//     there. `logStatus !== 'error' && logStatus !== 'loading'` is somebody
//     enumerating the bad statuses and missing the third, which is exactly
//     what the note in app/(client)/compare.tsx describes: "admits 'partial'
//     … under it a scan that fell off the end of a truncated read". If you are
//     going to enumerate, the enumeration is `isWhole`.
//
//     Both spellings, because the enumeration has two and this rule only ever
//     matched one of them. `status === 'error' || status === 'loading'` is the
//     same enumeration written from the other side — the guard clause, rather
//     than the permission — and it is the spelling people actually reach for
//     when they are bailing out at the top of a function. It went unseen from
//     the day this gate was written until app/(trainer)/videos.tsx was found by
//     hand: two sections there were gated on `status === 'error' || status ===
//     'loading'`, both providers genuinely answered 'partial'
//     (src/lib/templateLibrary.ts:153, src/ui/exerciseVideos.ts:244), and the
//     consequence was a coach being told a movement they had already filmed was
//     still to film — counted into "N to film", printed under "nothing to show".
//     The note forty-five lines below it in the same file already made that
//     argument about the same rows. The gate simply could not read the line.
//
//     The positive spelling is matched ONLY as a `||`-joined pair on the same
//     identifier, in either operand order and adjacent. That is not fussiness,
//     it is the difference between this rule and an unusable one. Roughly fifty
//     places in this tree dispatch a rendering per status —
//
//         status === 'loading' ? 'Reading your log…'
//           : status === 'error' ? 'We couldn’t read your log…'
//           : <the normal thing>
//
//     — and there 'error' and 'loading' are not being enumerated as a class at
//     all. They are two answers each getting their own sentence, with 'partial'
//     falling through to the render 'ready' gets, which is the house pattern and
//     is usually right. A rule that treated any co-occurrence of the two
//     comparisons as an enumeration would fire on every one of those on its
//     first run and be deleted within the week. The `||` is what says the author
//     wrote ONE predicate meaning "unusable" — and a predicate meaning
//     "unusable" that omits 'partial' is the claim this rule exists to doubt.
//
//     What it therefore cannot see: the ternary chain that ends in a branch
//     asserting an absence. app/(trainer)/client-training.tsx had exactly that
//     — `assigned.status === 'loading' ? … : assigned.status === 'error' ? … :
//     !program ? "The read came back and they are on no coach-assigned
//     programme"` — where under 'partial' a client whose row fell off a page
//     ordered by `client_id` produced that sentence about a client who had one.
//     It was found by reading, not by this rule, and it is fixed; the rule still
//     cannot reach its shape. See "what this cannot catch", below.
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
//
// Widening rule 2 to the positive spelling surfaced thirteen further sites and
// every one of them took a written reason rather than an edit — which reads,
// fairly, like a rule that needs thirteen exemptions on day one. Two things
// about that are worth recording, because the next person will want to soften
// the rule and one of the two ways of doing it is a trap.
//
// The first is that the sentences did the work. They were written by reading
// each site and arguing, in its own terms, why 'partial' is admissible there —
// and two of the thirteen turned out not to be admissible at all. `planVsActual`
// said "on no coach-assigned programme" off a truncated assignment read, on both
// the coach's screen and the member's; `publishConsentOf` said a client had not
// agreed to a photo when the row proving they had was on the other side of a
// page. Both are fixed. A survey that had trusted the sites and skipped the
// sentences would have annotated both as fine.
//
// The second is the trap. The obvious way to make thirteen exemptions go away is
// to add `didNotLand(s)` to src/ui/loadStatus.ts — one blessed helper for
// `s === 'loading' || s === 'error'`, with the argument for excluding 'partial'
// written once instead of thirteen times. Do not. That expression is the exact
// text this rule exists to look at, and a blessed spelling of it is a spelling
// the rule can never fire on. app/(trainer)/videos.tsx would have read
// `if (didNotLand(status)) return null;` and been just as wrong and completely
// invisible. The cost of this rule is that a correct guard has to say why it is
// correct. That cost IS the rule.
//
// ── what this cannot catch ────────────────────────────────────────────────
//
// It is line-local and it is meant to be. A tempting third option was to let a
// site off when the same identifier is compared against 'partial' somewhere
// nearby — the author has plainly thought about it, so why fire? Because
// app/(trainer)/videos.tsx, at the revision that carried the bug, already had
// `status === 'partial' ? 'Your library came back at the row limit…'` forty-five
// lines below the two gates that were wrong. Any lookahead wide enough to be
// useful would have cleared the one case this widening exists for. So: no
// lookahead, and the sites that handle 'partial' on the very next line —
// src/lib/injuryGate.ts and src/lib/coachClientReport.ts do — carry a marker
// saying so. That is the trade, made deliberately.
//
// It also cannot see:
//   · the ternary chain (above), which is where the client-training.tsx defect
//     lived. Catching it means asking what the fall-through branch CLAIMS, which
//     is a question about English and not about the expression.
//   · a disjunction whose two halves are not adjacent —
//     `s === 'error' || !rows || s === 'loading'`. None exists in this tree
//     today; the check is a substring match and would need a real parse.
//   · a status crossing a function boundary. `restOf` in src/lib/muscleRecovery.ts
//     answers 'partial' through `board.isFloor`, three files from the read.
//
// And rule 1b, specifically, cannot see these. They are listed because a gate
// that overclaims is worse than one that states its limits — check-mount-zone
// and check-currency-copies both write theirs down, and the second of those was
// widened only after it admitted in its own header that it had been watching the
// wrong half of the thing it named.
//
//   · A FIGURE THAT IS ALREADY A NUMBER. `note={known ? total : undefined}`,
//     where `total` was counted three lines up. 1b looks for the COUNTING —
//     `.length}` or a `, 0)` fold — so a count that has been given a name before
//     it reaches the gate is invisible. This is the single biggest hole and it is
//     the same hole rule 2 has: the check is line-local plus one named
//     indirection, and the indirection it follows is the GATE, not the figure.
//     Following the figure means constant-folding the file, which is a parse.
//   · A COUNT SPELLED ANY OTHER WAY. `String(rows.length)`, `plural(rows.length)`,
//     `rows.length.toString()`, `n = rows.length` — none of them closes a hole
//     with `}`, so none of them matches. `.length` as a function ARGUMENT is
//     excluded on purpose (calendar.tsx:700 is why), and that exclusion costs
//     `fmt(rows.length)` along with it. Accepted, knowingly.
//   · A MULTI-LINE FOLD. `.reduce((a, r) =>` on one line and `, 0);` on the next
//     is the prettier output for anything long, and 1b needs both on one line.
//   · A SUM THAT IS NOT A FOLD — a `SUM()` in a view, a total the server
//     computed, an `d3.sum`-shaped helper. There is no name-based aggregate
//     heuristic here at all, because `count`, `total` and `sum` are also the
//     commonest nouns in this tree and a name rule would fire on scores of
//     honest lines to catch none that exist.
//   · AN ALIAS THAT IS NOT A PLAIN `const`. A destructured one, a parameter, a
//     field, a `let` that is reassigned later. And the aliases it does follow are
//     matched BY NAME ACROSS THE WHOLE FILE with no scope analysis, so a second
//     `known` in another component in the same file would be conflated with the
//     first. Every one of the eight aliases in this tree today is a single
//     component-top `const`; the day that stops being true, this is the
//     assumption that breaks.
//   · THE HONEST TRUNCATION CAPTION. "showing 20" beside a stated limit is a
//     claim about the page and not about the set, and is correct — and 1b will
//     fire on it, because the distinction lives in the surrounding English.
//     Write the `whole-ok:` reason. The rule asks for the sentence; it does not
//     pretend it can read it.
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
 *
 * Rule 1b added nothing to this list, and the empty result is a finding rather
 * than a shrug, so here is the whole of what it examined. Forty non-comment
 * lines in these five roots carry `!== 'error'` at all. Eight of them are a
 * `const` binding the comparison to a name. Run wide — every `.length` in any
 * position, every `.reduce(`, and every call whose name reads like an aggregate
 * — exactly two lines in the tree pair one of those gates with a figure:
 *
 *   app/(trainer)/calendar.tsx:700   `known, hasWeekly: weeklyFromSlots(availStatus, availSlots.length), …`
 *     Not a defect and not flagged. `known` is a field in an object literal and
 *     is gating nothing; the length is an argument to a function that is handed
 *     the status separately and decides for itself. This is the line the
 *     "must be GATING" requirement was written against.
 *
 *   app/(trainer)/my-nutrition.tsx:791  `note={known && whole && fl.entries.length ? …}`
 *     Not a defect and not flagged. It is the sibling of the line this rule
 *     exists for, on the coach's own nutrition screen rather than their own
 *     training screen, and it was written correctly: `whole` is `isWhole(fl.status)`
 *     and is what decides. It is here because it is the shape rule 1b must
 *     never fire on, and because it shows the defect was one screen's slip and
 *     not a habit.
 *
 * The one true positive rule 1b was written for — my-training.tsx's "Today · N"
 * — was fixed by the lane that found it before this widening landed, so the
 * rule ships green and guards a line that is already right. That is the
 * intended end state and not a reason to doubt the rule: the three fixtures in
 * the lane note reconstruct the pre-fix line and it fails on it.
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

/** The same, positively: `<something> === 'error'`. Only a starting point — a
 *  bare `=== 'error'` is the most ordinary line in this tree and means nothing
 *  on its own. What makes it rule 2 is the `||` pair below. */
const EQ_ERROR = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*===\s*'error'/g;

/**
 * An assertion that a list is EMPTY. Only these three: `=== 0`, `< 1`, and a
 * bare `!list.length`. Deliberately not `!== 0` or a bare `.length` — those
 * mean "there are some", and showing rows that genuinely exist is honest under
 * 'partial'.
 */
const CLAIMS_EMPTY = /\.length\s*===\s*0|\.length\s*<\s*1|![A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\.length\b/;

/* ── rule 1b: the figure, the gate's name, and the right gate's name ─────── */

/**
 * A COUNT being handed to the reader: `.length` immediately closing a hole.
 * `${rows.length}` and `{rows.length}` both end `.length}`; `.length ?`,
 * `.length &&`, `.length > 0`, `.length)` and `.length - 1` are tests,
 * arguments and arithmetic, and are none of this rule's business. See the
 * header for the two lines in this tree that turn on that distinction.
 */
const RENDERS_COUNT = /\.length\s*\}/;

/**
 * An ARITHMETIC FOLD: a `.reduce(` seeded with a number, on one line. A fold
 * seeded with `0` is a total; one seeded with `new Map()` or `[]` is a regroup
 * and claims nothing. Both halves must be on the line — a fold prettier has
 * split across two is a miss, and the header says so.
 */
const SUMS = (l) => /\.reduce\s*\(/.test(l) && /,\s*(?:0|0\.0)\s*\)/.test(l);

/**
 * A NAME FOR THE WEAK GATE: a `const` whose ENTIRE right-hand side is the one
 * comparison. `const known = status !== 'error';` is the weak gate wearing a
 * name, and Lane 85's count was gated on the name six hundred lines from the
 * comparison. Nothing compound is followed — see the header.
 */
const WEAK_ALIAS = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*!==\s*'error'\s*;\s*$/;

/** The mirror: a name for the RIGHT gate. `const whole = isWhole(fl.status);` */
const WHOLE_ALIAS = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*isWhole\([^()]*\)\s*;\s*$/;

const word = (id) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

/**
 * Is the gate actually GATING the figure, rather than merely sharing a line
 * with it? It must stand BEFORE the figure and be joined to it as a condition —
 * an `&&`, or a ternary `?`. `?.` and `??` are stripped first: they are not
 * gates, and treating them as such is how app/(trainer)/calendar.tsx:700 gets
 * called a defect.
 */
function gatesTheFigure(line, gateEnd, figStart) {
  if (gateEnd > figStart) return false;
  const between = line.slice(gateEnd, figStart).replace(/\?\?|\?\./g, '');
  return /&&|\?/.test(between);
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
  /* One pass for the two families of name before any line is judged, because
   * Lane 85's alias was declared at line 163 and used at 784. File-local, by
   * name, no scope analysis — the header names that as an assumption. */
  const weakAliases = new Map();
  const wholeAliases = new Set();
  lines.forEach((l, i) => {
    let m;
    if ((m = WEAK_ALIAS.exec(l))) weakAliases.set(m[1], { line: i + 1, src: m[2] });
    if ((m = WHOLE_ALIAS.exec(l))) wholeAliases.add(m[1]);
  });
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    /* Both spellings of the enumeration reach the same rule, so both feed the
     * same candidate list — and each identifier is judged once, whichever
     * pattern put it there. */
    const ids = [];
    for (const re of [NOT_ERROR, EQ_ERROR]) {
      re.lastIndex = 0;
      let x;
      while ((x = re.exec(line))) ids.push(x[1]);
    }
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rulesOutLoading = new RegExp(esc + "\\s*!==\\s*'loading'").test(line);
      const rulesOutPartial = new RegExp(esc + "\\s*!==\\s*'partial'").test(line);
      const rulesOutError = new RegExp(esc + "\\s*!==\\s*'error'").test(line);
      /* The positive spelling, and ONLY as one `||`-joined pair on one
       * identifier: `s === 'error' || s === 'loading'`, or the same written the
       * other way round. Adjacent and `||`-joined is what separates a single
       * predicate meaning "unusable" from a ternary chain giving each of the two
       * its own sentence — see the header. `!(…)` around it still matches, and
       * should: negating an enumeration that is missing a case does not supply
       * the case. */
      const eqPair = new RegExp(
        `${esc}\\s*===\\s*'error'\\s*\\|\\|\\s*${esc}\\s*===\\s*'loading'`
        + `|${esc}\\s*===\\s*'loading'\\s*\\|\\|\\s*${esc}\\s*===\\s*'error'`,
      ).test(line);
      /* `s === 'partial'` on the same line is the author naming the third
       * answer in the same breath, which is the whole of what this rule asks
       * for. Anything further away is not something a line-local rule may
       * assume — the header says why, and names the file that proves it. */
      const namesPartial = new RegExp(esc + "\\s*===\\s*'partial'").test(line);

      let rule = null;
      if (rulesOutError && rulesOutLoading && !rulesOutPartial) {
        rule = {
          n: 2,
          wrong: `\`${id}\` is ruled out of 'error' and 'loading' and left free to be 'partial' — a read that came back at PostgREST's 1000-row ceiling, whose rows are real and whose SET is a prefix`,
        };
      } else if (eqPair && !namesPartial) {
        rule = {
          n: 2,
          wrong: `\`${id}\` is caught for 'error' and for 'loading' by one predicate, and 'partial' falls straight through it — a read that came back at PostgREST's 1000-row ceiling, whose rows are real and whose SET is a prefix. This is the enumeration written as a guard clause rather than as a permission; it is the same omission either way`,
        };
      } else if (rulesOutError && !rulesOutLoading && CLAIMS_EMPTY.test(line)) {
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

    /* ── rule 1b — a FIGURE drawn under a gate that only ruled out failure ──
     *
     * Separate from the loop above because the gate need not be a comparison on
     * this line: it may be a NAME for one, declared hundreds of lines up. */
    const countAt = line.search(RENDERS_COUNT);
    const foldAt = SUMS(line) ? line.search(/\.reduce\s*\(/) : -1;
    const figStart = countAt >= 0 ? countAt : foldAt;
    if (figStart < 0) return;
    const figure = countAt >= 0 ? 'count' : 'total';

    /* The right gate, by call or by name, anywhere on the line. my-nutrition's
     * `known && whole && …` is the sibling of the line this rule exists for and
     * was always correct; flagging it would be flagging the fix. */
    if (/\bisWhole\s*\(/.test(line)) return;
    for (const w of wholeAliases) if (word(w).test(line)) return;

    /* Candidate gates: the weak comparison written out, and every name bound to
     * one. Each carries where it ENDS, because a gate that stands after the
     * figure is not gating it. */
    const gates = [];
    for (const m of line.matchAll(/([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*!==\s*'error'/g)) {
      /* If the line rules out 'loading' too it is rule 2's line, not this one,
       * and reporting it twice teaches nobody anything new. */
      if (new RegExp(`${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*!==\\s*'loading'`).test(line)) continue;
      gates.push({ id: `${m[1]} !== 'error'`, end: m.index + m[0].length, named: null });
    }
    for (const [a, meta] of weakAliases) {
      if (i + 1 === meta.line) continue;                  // the declaration itself
      const w = word(a);
      let idx = -1;
      const g = new RegExp(w.source, 'g');
      let x;
      while ((x = g.exec(line))) { if (x.index < figStart) idx = x.index + x[0].length; }
      if (idx < 0) continue;
      gates.push({ id: a, end: idx, named: meta });
    }

    const gate = gates.find((g) => gatesTheFigure(line, g.end, figStart));
    if (!gate) return;
    if (markedAbove(lines, i + 1, /whole-ok:\s*\S/)) return;

    const via = gate.named
      ? `\`${gate.id}\` is \`${gate.named.src} !== 'error'\` (declared at line ${gate.named.line}) — a name for "the read did not fail", which is not the claim`
      : `\`${gate.id}\` rules out failure and nothing else`;
    found.push({
      rel,
      line: i + 1,
      rule: '1b',
      wrong: `a ${figure} is drawn here, and ${via}. Under 'loading' there is nothing behind the number yet; under 'partial' it is a ${figure} over a set that is a PREFIX — and \`useWorkoutLog\` reaches 'partial' by a route that has nothing to do with the server, \`setQueueStatus(queueRead ? 'ready' : 'partial')\` at src/ui/workoutLog.tsx:314, where the rows missing are the ones logged with no signal`,
      text: line.trim().slice(0, 110),
    });
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
console.log(`check-whole — ok, ${files.length} files; no new count, total or empty-state gated on "did not fail"${backlog ? `, ${backlog} known and ratcheted` : ''}`);
