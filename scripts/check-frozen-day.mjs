#!/usr/bin/env node
// A clock that stopped when the screen opened.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
//     const today = useMemo(() => todayKey(), []);
//
// An empty dependency array does not fix a value "for the render". It fixes it
// for the life of the MOUNT, and on a phone that is not a short window.
// app/(trainer)/_layout.tsx registers its detail screens with `href: null`,
// which mounts them once; backgrounding the app does not tear them down at all.
// A screen opened on Sunday and returned to on Wednesday is still answering
// Sunday's question.
//
// The worst one found today was app/(trainer)/credentials.tsx, where the frozen
// day was the second argument to every judgement the screen makes —
// `sortCredentials`, `insuranceClaim`, `credentialState`, `expiryLine`. A
// coach's public liability policy that ran out on Monday read as current, in
// the green, on the one screen whose entire job is to say when their cover
// runs out. Whether they could lawfully stand on a gym floor hung off a date
// the screen had quietly stopped updating. Three more were found in the same
// sweep: Analytics, Money and the Assistant are TABS — mounted for as long as
// the app is — and each set both bounds of a month-to-date window from a
// frozen `new Date()`, so a coach who opened Analytics on the 31st and came
// back on the 1st was shown last month's takings under a heading saying this
// month, and a pull-to-refresh re-read the server against the same wrong dates,
// which made the stale figure look freshly confirmed.
//
// ── why a gate and not a fix ──────────────────────────────────────────────
//
// All four were fixed. The fix is a hook — `useToday()` and `useNow()` in
// src/ui/today.ts — and its header argues the whole case. The problem is that
// the WRONG form is the obvious one: a reviewer reading `useMemo(() =>
// todayKey(), [])` sees a memo with no dependencies, which is exactly what a
// memo of a constant should look like, and nothing on the line says the value
// is not constant. It reads as correct. It compiles, type-checks, and behaves
// perfectly for the length of any session anybody tests it in.
//
// So this is not a defect people fail to understand. It is one they cannot see,
// four times in one day, in files that had already been reviewed. That is the
// definition of something that wants a gate.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Two shapes, both of which mean "computed once, at mount, and never again":
//
//   1. `useMemo(… , [])` — an empty dependency array — whose body reads the
//      clock at all: `todayKey()`, `isoDay(…)`, `gymDay(…)`, `weekStartIso(…)`,
//      `new Date()`, `Date.now()`, `.toISOString().slice(…)`.
//
//   2. `const [x] = useState(…)` with NO setter destructured, where the initial
//      value is a CALENDAR DAY — `todayKey()`, `isoDay(…)`, `gymDay(…)`,
//      `weekStartIso(…)`, `new Date().toISOString().slice(…)`.
//
//   3. A clock read STANDING IN THE RENDER BODY that becomes a calendar day:
//      `const thisWeek = weekStartOf(Date.now(), zone);` written straight into
//      a component, in no hook at all. See the section below.
//
// The right answers are `useToday()` for a day and `useNow()` for an instant.
// Both live in src/ui/today.ts, both re-settle on the two moments that matter —
// the local day rolling over, and the app coming back to the foreground — and
// neither re-renders on any other tick, so nothing gets slower.
//
// ── why rule 2 is narrower than rule 1, on purpose ────────────────────────
//
// A setter-less `useState` holding an INSTANT is a legitimate and deliberate
// pattern in this tree, and two pages document why they use it: the analytics
// console freezes `Date.now()` so that the month counted as "running" cannot
// change underneath a table somebody is reading, and the invites console
// freezes it so a column of "3 days ago" does not tick over mid-read. Those are
// correct. Flagging them would put a gate in front of a decision that was made
// well, and a gate people argue with is a gate people switch off.
//
// A frozen calendar DAY is different in kind, and that is the whole distinction
// this file turns on. "Now" going stale by ten minutes changes a relative label.
// "Today" going stale by one day changes an ANSWER: expired reads as current,
// overdue reads as due, last month reads as this month. There is no reading of
// a screen for which yesterday's date is the right one to judge against.
//
// `useRef(todayKey())` is also not flagged, for the same reason in reverse:
// this tree's one instance of it (studio-web/app/money/page.tsx) is a sentinel
// recording what the component last SEEDED a date input with, so that a late
// tenant read never overwrites a date somebody typed. It is not being asked
// what day it is. Nothing about a ref says the value is meant to stay current,
// so there is no honest rule to write there — a person reading a ref of a date
// has to think about it, which is the outcome anyway.
//
// ── rule 3: the read that is in no hook at all ────────────────────────────
//
// Rules 1 and 2 both look INSIDE a hook, and a lane mutation-testing this gate
// found what that leaves out twice in one night:
//
//     export default function OwnerRota() {
//       …
//       const thisWeek = weekStartOf(Date.now(), zone);
//
// No `useMemo`, no `useState`, no dependency array to get wrong — and no gate.
// A value in a render body is recomputed on every RENDER, which sounds like the
// opposite of frozen, and is, right up until you ask what re-renders a screen
// in this app. `expo-router`'s `Tabs` keep every tab screen MOUNTED, and a
// screen registered `href: null` mounts once and is never torn down at all
// (app/(trainer)/_layout.tsx). Nothing re-renders on the passage of time. So a
// day computed here is the day of the last state change — which may be the day
// the screen was first opened, and on a phone that is not a short window.
//
// Three of these were found on the Home screen alone: one filed yesterday's
// session under "Today", one printed a stale date in the greeting, and one
// decided WHICH CARD RENDERS, so a member who trained on Monday woke on Tuesday
// to "Session Done" and no Start button.
//
// ── the distinction this rule has to get right ────────────────────────────
//
// A `Date.now()` in a render body is NOT always wrong, and a rule that cannot
// tell the difference would be a rule people switch off. Inside an event
// handler, a callback or an effect, the body runs at the moment of the EVENT
// and the read is fresh however long the screen has been up — the same argument
// check-frozen-hook.mjs makes for leaving `useCallback` and `useEffect` alone.
// Only a read evaluated DURING RENDER can go stale, so only those are counted:
// the scan walks a component body left to right and skips every nested function
// whole — `=>` and `function` alike — so a clock inside `onPress={() => …}`, a
// `useEffect(() => …)`, a `.map(row => …)` or a plain helper is never reached.
//
// Two further narrowings, each with a reason:
//
//   · THE VALUE HAS TO BECOME A CALENDAR DAY. `const nowMs = readAt ??
//     Date.now()` is an instant used for "3 days ago", and `pausedAtRef.current
//     = Date.now()` is stopwatch arithmetic; both re-read the wall clock for
//     figures that are allowed to be ten minutes old. This is the same line
//     rule 2 draws and the header above argues it: "now" going stale changes a
//     label, "today" going stale changes an ANSWER. Twenty-five console pages
//     read `Date.now()` in a render body for exactly that kind of figure and
//     none of them is this defect.
//
//   · THE COMPONENT MUST SUBSCRIBE TO NO CLOCK. If the same body calls
//     `useToday()`, `useNow()`, `useMonthTick()` or `useHourTick()`, the
//     component is re-rendered when the day (or month, or hour) turns, and a
//     clock read beside that hook re-settles with it. Those are the four hooks
//     check-frozen-hook.mjs already knows by name, used here for the same
//     purpose and with the same list, rather than a second vocabulary.
//     app/(client)/workouts.tsx says so in its own comment above `useToday()`.
//
// ── what rule 3 deliberately leaves to other gates ────────────────────────
//
// A clock read inside a `use…(` call's arguments — `useState(todayKey())`,
// `useRef(Date.now())` — is skipped here whole. It is not allowed; it is
// already owned, by rule 2 above, by check-mount-zone.mjs, and by
// check-frozen-hook.mjs, and a defect reported by two gates with two different
// remedies is a defect nobody fixes.
//
// And the console is out of scope for this rule, on purpose. `studio-web`'s
// house line is
//
//     const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
//
// in a render body, on nine pages — and that is the shape check-mount-zone.mjs
// ASKS FOR, its whole point being that the value must not be latched at mount
// while `zone` is still null. Flagging here what another gate requires there
// would leave nine pages with no correct form available. The mechanism this
// rule is about is expo-router's, so the rule is scoped to where expo-router
// is: `app` and `src`.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// A screen that genuinely wants the day it opened on — a receipt, a stamped
// snapshot, anything that is recording a moment rather than judging against
// one — says so on the line or in the comment immediately above it:
//
//     // frozen-day-ok: this stamps the export with the day it was TAKEN, and a
//     // stamp that moved after the fact would be a different claim
//
// The sentence is the point, exactly as with `no-error-ok:` in check-reads.mjs
// and `keyboard-ok:` in check-keyboard.mjs. It is what a reviewer reads when
// deciding whether "this value should not move" is honestly true.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere a React component is written. The console is included: its pages
 *  are left open on a front desk for days, which is the same failure. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * Does a marker apply to `line` (1-based)?
 *
 * On the line itself, or anywhere in the unbroken run of comment and blank
 * lines immediately above it. It has to be allowed above the line for the
 * reason check-rtl.mjs gives — a `//` inside JSX renders as two slashes on
 * somebody's screen — but it is a RUN and not a window of N lines, so an
 * annotation can never drift down and excuse the statement after the one it
 * was written for.
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

/** Reading the clock, in any form this tree uses. */
const READS_CLOCK = /\btodayKey\s*\(|\bisoDay\s*\(|\bgymDay\s*\(|\bweekStartIso\s*\(|\bstartOfWeek\s*\(|new\s+Date\s*\(|\bDate\.now\s*\(/;

/** Reading the clock and turning it into a CALENDAR DAY. The narrower set; see
 *  the header on why rule 2 uses it and rule 1 does not. */
const READS_DAY = /\btodayKey\s*\(|\bisoDay\s*\(|\bgymDay\s*\(|\bweekStartIso\s*\(|toISOString\s*\(\)\s*\.\s*slice\s*\(/;

/* ── rule 3's vocabulary ───────────────────────────────────────────────────
 *
 * Deliberately the same words the other two clock gates already use, rather
 * than a second set: see the header on why a rule that invents its own names
 * for this codebase's clock is a rule nobody can reconcile with the ones
 * beside it.
 */

/** Reading the clock with NO argument — check-frozen-hook.mjs's set, for the
 *  reason its header gives: `new Date(row.startsAt)` is on hundreds of lines
 *  and reads a row, not a clock. Rules 1 and 2 can afford the looser form
 *  because an empty dependency array has nothing in scope to pass; a render
 *  body has the whole component in scope, so here it cannot. `g` because rule
 *  3 scans a body position by position rather than testing a string. */
const BARE_CLOCK = /\bDate\s*\.\s*now\s*\(\s*\)|new\s+Date\s*\(\s*\)|\btodayKey\s*\(\s*\)|\bstartOfWeek\s*\(\s*\)|\bweekStartIso\s*\(\s*\)/g;

/**
 * Turning a clock read into a CALENDAR DAY, WEEK, MONTH or YEAR — the unit
 * whose going stale changes an answer rather than a label.
 *
 * READS_DAY above is rule 2's version of this and stops at the day. Rule 3
 * carries the same idea up to the year because the three defects it found do:
 * a rota keyed on `weekStartOf`, a statement whose year list comes from
 * `getFullYear()`. A week that is last week and a year that is last year are
 * the same defect as a day that is yesterday, and nothing else on those
 * screens says otherwise.
 */
const FORMS_A_DAY = new RegExp([
  READS_DAY.source,
  '\\bstartOfWeek\\s*\\(', '\\bweekStartOf\\s*\\(', '\\bmonthKeyOf\\s*\\(',
  '\\bdayKeyOf\\s*\\(', '\\bisoDate\\s*\\(',
  // `new Date().getFullYear()` and its three siblings: a calendar part taken
  // straight off the clock, which is how app/(trainer)/statement.tsx builds the
  // year picker a coach does January's paperwork in.
  '\\.\\s*get(?:FullYear|Month|Date|Day)\\s*\\(\\s*\\)',
].join('|'));

/** The four hooks that re-render a component when time turns: the phone app's
 *  two (src/ui/today.ts) and the console's two (studio-web/lib). The same list
 *  check-frozen-hook.mjs keeps, by name, for the same purpose — a body that
 *  calls one of these is re-rendered at the boundary, so a clock read beside it
 *  re-settles with it and is not frozen. */
const CLOCK_HOOK = /\buse(?:Today|Now|MonthTick|HourTick)\s*\(/;

/** Where rule 3 looks. Not the console: its render-body `gymDay(Date.now(),
 *  zone) ?? isoDate(new Date())` is the shape check-mount-zone.mjs requires, and
 *  a line one gate demands and another forbids leaves nine pages with no
 *  correct form. The mechanism rule 3 is about — a tab screen that mounts once
 *  and is never torn down — is expo-router's, and expo-router is here. */
/**
 * Rule 3's roots, and its own empty-set floor, in ONE constant so the two
 * cannot drift apart.
 *
 * scripts/gate-floor.mjs floors the FILES a root produced, and that is not
 * enough here: rule 3 only reports from bodies its parser recognises as
 * components, so a parser that quietly stopped matching would walk every file
 * and report nothing. And gate-floor cannot see a root that has been deleted
 * from an array — its own header says so — because a root that is not in the
 * counts is not in the loop.
 *
 * Both holes close if the roots ARE the floors: the walk iterates these keys,
 * the floor check iterates these keys, and deleting one is deleting a number
 * somebody has to replace. The values are roughly half of what each root held
 * on 14 September 2026 (app 257, src 176), on gate-floor.mjs's reasoning: far
 * enough below the truth to be quiet on a day somebody deletes a screen, far
 * enough above zero that a root going missing cannot be.
 *
 * The console is deliberately not here. Its render-body `gymDay(Date.now(),
 * zone) ?? isoDate(new Date())` is the shape check-mount-zone.mjs REQUIRES, and
 * a line one gate demands and another forbids leaves nine pages with no correct
 * form. The mechanism rule 3 is about — a tab screen that mounts once and is
 * never torn down — is expo-router's, and expo-router is here.
 */
const RENDER_SCOPE_FLOORS = { 'app': 100, 'src': 80 };
const RENDER_ROOTS = Object.keys(RENDER_SCOPE_FLOORS);

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs. Empty: every
 * entry this gate has ever carried has been closed by the lane that owned the
 * file, which is the only way an entry here is meant to leave.
 *
 * A ratchet, not an ignore list, on exactly the terms `KNOWN` sets out in
 * check-dead-exports.mjs: a file listed at 1 fails the build at 2, and a count
 * that has DROPPED fails too, so the list can only shrink. Both entries this
 * gate's first run found are now cleared and the list is empty.
 *
 * `app/(owner)/revenue.tsx` — `forecastLabels` now derives its seven month keys
 * from `useToday()` and carries it in the dependency array. `useNow()` was what
 * this entry asked for and `useToday()` is the narrower right answer: the value
 * that has to stay true is a MONTH, `useToday` compares the day before it sets,
 * so the labels recompute at most once a day and only produce a new array on
 * the days that would produce a different one. Deriving the months FROM the day
 * string also removes the second clock read, so the value and its dependency
 * cannot come from two different instants.
 *
 * `studio-web/app/revenue/page.tsx` — `since` is no longer held at all. The
 * entry proposed a `useNow()` with `load` depending on it; there is no
 * `useNow()` in the console (src/ui/today.ts imports react-native's AppState),
 * and the better shape was available anyway: a window bound belongs to the READ
 * and not to the component, so it is computed inside `load`. There is now no
 * value to go stale and no dependency to forget. The same change wired the page
 * to `useFetched`/`Fetched` from studio-web/components/Fetched.tsx, which is
 * what made the frozen bound urgent rather than theoretical — before it, the
 * page's only refresh was a full document reload, which remounted and hid the
 * defect; now the tab coming back re-reads, and it re-reads a window ending
 * today.
 *
 * ── the three rule 3 found, keyed `<file>:render-body` ────────────────────
 *
 * All three are in other lanes' files tonight, so they are ratcheted and NOT
 * annotated: pasting a `frozen-day-ok:` into somebody else's screen would
 * silence the rule from the position least able to judge whether the day is
 * allowed to stand still there, which is the one thing an escape hatch must
 * never be used for. A drop here is fatal, exactly as it is for rules 1 and 2 —
 * the entry names the edit, and when the edit lands the number comes down with
 * it rather than sitting on as a tolerated line.
 */
const KNOWN = new Map([
  // app/(trainer)/statement.tsx:render-body — CLOSED while this rule was being
  // written, by the lane that owns the file, and with exactly the edit the entry
  // named: `const thisYear = useNow().getFullYear()` and an import of
  // src/ui/today. The entry is deleted rather than zeroed — a zero is still an
  // exemption and there is nothing left to exempt.
  //
  // app/(trainer)/log-session.tsx:render-body — CLOSED, and it was the worst of
  // the three because the frozen day was not a label but a WRITE: `logStamp`
  // files the session under it. The entry asked for `useToday()` and the answer
  // is `useNow()`, for a reason the entry could not see from outside the file —
  // the screen holds an HOUR beside the day, seeded from the same mount-time
  // clock, and moving the day alone would offer a coach who opened the screen
  // at 23:00 on Sunday "Monday at 11 pm", an hour `logStampProblem` refuses to
  // save. One subscription now feeds both. The day and hour are also no longer
  // held at all: the coach's CHOICE is the state and `null` means "not chosen",
  // so the default follows the clock and the client-change re-seed is
  // `setChosenDay(null)` rather than a second read of it.
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
 * The source with every comment and string body replaced by spaces of the same
 * length, so offsets, line numbers and bracket balance are all unchanged.
 *
 * This is not fastidiousness. Every file named in this header quotes the WRONG
 * form in its own comment explaining what it stopped doing — src/ui/today.ts
 * quotes it three times — so a scanner that reads comments reports the fix as
 * the bug. And blanking comments naively, by looking for `//`, eats the `//` in
 * a URL inside a string and takes the rest of the line's real code with it.
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

/** The index of the bracket closing the one at `open`, or -1. `callText`'s
 *  arithmetic, generalised, because rule 3 has to balance `{` as well. */
function matchedEnd(src, open, oc, cc) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === oc) depth++;
    else if (c === cc) { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/**
 * Every RENDER SCOPE in a blanked file: the `{ … }` body of a component or a
 * hook, as `{ name, start, end }` with `start` at the opening brace.
 *
 * "Component or hook" is React's own naming rule — a capitalised name or a
 * `useX` one — and nothing else, because nothing else is rendered. A
 * capitalised function that is not a component (there are a few: formatters,
 * constructors) is then filtered out at the call site by asking whether its
 * body calls a hook or contains JSX, which is the only honest evidence
 * available without the render graph.
 *
 * A component declared inside another is found twice: once as its own scope,
 * and once as a nested function inside the outer one — where `renderReads`
 * skips it whole. So each read is attributed to the scope that actually
 * evaluates it, and never to both.
 */
function renderScopes(src) {
  const out = [];
  const DECL = new RegExp(
    // `function Screen(` / `export default function Screen(` / `function useThing(`
    '(?:export\\s+default\\s+)?(?:export\\s+)?(?:async\\s+)?function\\s+([A-Z][\\w$]*|use[A-Z][\\w$]*)\\s*(?:<[^>{}()]*>)?\\s*\\('
    // `const Card = (` / `const Card = React.memo((` / `const useThing = (`
    + '|(?:export\\s+)?const\\s+([A-Z][\\w$]*|use[A-Z][\\w$]*)\\s*(?::[^=;]*)?=\\s*(?:React\\.memo\\s*\\(\\s*)?(?:async\\s*)?(?:<[^>{}()]*>)?\\s*\\(',
    'g',
  );
  let m;
  while ((m = DECL.exec(src))) {
    const name = m[1] || m[2];
    const paren = src.indexOf('(', m.index + m[0].length - 1);
    const close = matchedEnd(src, paren, '(', ')');
    if (close < 0) continue;
    let k = close + 1;
    while (k < src.length && /[\s:]/.test(src[k])) k++;
    if (src.startsWith('=>', k)) { k += 2; while (k < src.length && /\s/.test(src[k])) k++; }
    else if (m[2]) continue;                 // `const X = (…)` with no `=>`: a call, not a function
    // A concise-body arrow (`const Row = () => <Text …/>`) has no statements to
    // freeze — every expression in it is evaluated on every render by
    // definition — so only a braced body is a scope.
    if (src[k] !== '{') continue;
    const end = matchedEnd(src, k, '{', '}');
    if (end < 0) continue;
    out.push({ name, start: k, end });
  }
  return out;
}

/**
 * The bare clock reads that are evaluated DURING RENDER inside `[start, end]`.
 *
 * One left-to-right pass. Whenever the scan meets something whose body runs
 * later, it jumps over the whole of it and never looks inside:
 *
 *   · `function` — a nested declaration or expression; a helper is called, not
 *     rendered.
 *   · `=>` — every arrow, which is where this codebase writes its event
 *     handlers, its effects, its callbacks and its `.map` bodies. A braced
 *     arrow ends at its matching `}`; a concise one ends at the first `,`, `;`
 *     or unmatched closer, which is what terminates the expression it is.
 *   · `useX(…)` — a hook call's arguments, whole. `useState(todayKey())` and
 *     `useRef(Date.now())` are not allowed; they are OWNED, by rule 2 above and
 *     by check-mount-zone.mjs, and a defect reported twice with two different
 *     remedies is a defect nobody fixes.
 *
 * What is left is the render body itself, which is the only place a clock read
 * can go stale — the header argues that at length.
 */
function renderReads(src, start, end) {
  const hits = [];
  let i = start + 1;
  while (i < end) {
    if (src.startsWith('function', i)
      && !/[\w$]/.test(src[i - 1] ?? ' ') && !/[\w$]/.test(src[i + 8] ?? ' ')) {
      const p = src.indexOf('(', i);
      if (p < 0 || p > end) break;
      const pc = matchedEnd(src, p, '(', ')');
      let k = pc + 1;
      while (k < end && src[k] !== '{') k++;
      const e = matchedEnd(src, k, '{', '}');
      i = e > 0 ? e + 1 : i + 8;
      continue;
    }
    if (src.startsWith('=>', i)) {
      let k = i + 2;
      while (k < end && /\s/.test(src[k])) k++;
      if (src[k] === '{') {
        const e = matchedEnd(src, k, '{', '}');
        i = e > 0 ? e + 1 : k + 1;
        continue;
      }
      let depth = 0;
      while (k < end) {
        const ch = src[k];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
        else if ((ch === ',' || ch === ';') && depth === 0) break;
        k++;
      }
      i = k;
      continue;
    }
    const hook = /^use[A-Z][\w$]*\s*(?:<[^>{}()]*>)?\s*\(/.exec(src.slice(i, i + 120));
    if (hook && !/[\w$.]/.test(src[i - 1] ?? ' ')) {
      const p = src.indexOf('(', i + hook[0].length - 1);
      const e = matchedEnd(src, p, '(', ')');
      i = e > 0 ? e + 1 : i + hook[0].length;
      continue;
    }
    BARE_CLOCK.lastIndex = i;
    const cm = BARE_CLOCK.exec(src);
    if (cm && cm.index === i) { hits.push({ at: i, text: cm[0] }); i += cm[0].length; continue; }
    i++;
  }
  return hits;
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
assertRootFloors('check:frozen-day', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check.
if (files.length < 150) {
  console.error(`check-frozen-day: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
/* Rule 3's own empty-set guards. Its scan is narrower than the file walk in two
 * ways that a file count cannot see — it looks only under RENDER_ROOTS, and only
 * inside bodies its own parser recognises as components — so each is counted and
 * floored separately below. A rule that walked 1,070 files, recognised no
 * component in any of them and printed "ok" would be making a claim about a tree
 * it never opened, which is the failure scripts/gate-floor.mjs exists for. */
const perRenderRoot = new Map(RENDER_ROOTS.map((r) => [r, 0]));
const perRenderRootScopes = new Map(RENDER_ROOTS.map((r) => [r, 0]));

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = blank(raw);
  const rel = relative(ROOT, f);
  const rawLines = raw.split('\n');
  const srcLines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const marked = (line) => markedAbove(rawLines, line, /frozen-day-ok:\s*\S/);

  // ── rule 1: useMemo with an empty dependency array that reads the clock ──
  for (let i = src.indexOf('useMemo'); i >= 0; i = src.indexOf('useMemo', i + 1)) {
    const open = src.indexOf('(', i + 7);
    if (open < 0 || /\S/.test(src.slice(i + 7, open).replace(/<[^>]*>/g, ''))) continue;
    const text = callText(src, open);
    if (!text) continue;
    // An empty dependency array as the second argument. `[]` and nothing else:
    // a memo with real dependencies re-runs when they move and is not this bug.
    // The `,?` allows the trailing comma this tree writes on a multi-line call.
    // Without it `useMemo(() => todayKey(), [],)` matches nothing and is
    // invisible to this gate — the same blind spot that hid two frozen memos
    // from the first draft of scripts/check-frozen-hook.mjs.
    if (!/,\s*\[\s*\]\s*,?\s*\)$/.test(text)) continue;
    if (!READS_CLOCK.test(text)) continue;
    const line = lineOf(i);
    if (marked(line)) continue;
    const day = READS_DAY.test(text);
    found.push({
      // The ratchet key. Rules 1 and 2 have always been counted per FILE and
      // stay that way; rule 3 counts under a key of its own, so a file allowed
      // one render-body read does not thereby tolerate a frozen memo as well.
      key: rel, rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      wrong: `useMemo(…, []) reading the clock — an empty dependency array fixes this for the life of the MOUNT, and nothing in these apps unmounts a screen when the phone is pocketed`,
      right: day
        ? 'useToday() from src/ui/today.ts — the same string, re-settled at the next local midnight and on every foreground'
        : 'useNow() from src/ui/today.ts — the same Date, re-settled at midnight, on foreground, and when the screen is focused',
    });
  }

  // ── rule 2: a setter-less useState holding a calendar day ───────────────
  const STATE = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState/g;
  let m;
  while ((m = STATE.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    if (open < 0) continue;
    const text = callText(src, open);
    if (!text || !READS_DAY.test(text)) continue;
    const line = lineOf(m.index);
    if (marked(line)) continue;
    found.push({
      key: rel, rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      wrong: `useState with no setter, holding a calendar day — \`${m[1]}\` is the day the screen OPENED on and can never become the day it is being read on`,
      right: 'useToday() from src/ui/today.ts. If the day genuinely must not move, keep it and say so: `// frozen-day-ok: <why yesterday is the right day to judge against>`',
    });
  }

  // ── rule 3: a clock read standing in the render body ────────────────────
  const renderRoot = RENDER_ROOTS.find((r) => rel === r || rel.startsWith(`${r}/`));
  if (!renderRoot) continue;
  perRenderRoot.set(renderRoot, perRenderRoot.get(renderRoot) + 1);

  const already = new Set();
  for (const scope of renderScopes(src)) {
    const body = src.slice(scope.start, scope.end);
    // A capitalised function that neither calls a hook nor contains a tag is
    // not a component, whatever it is called, and a clock read at the top of
    // one is evaluated on every CALL rather than every render.
    if (!/\buse[A-Z][\w$]*\s*\(/.test(body) && !/<[A-Za-z]/.test(body)) continue;
    perRenderRootScopes.set(renderRoot, perRenderRootScopes.get(renderRoot) + 1);
    // The body subscribes to a clock, so the component is re-rendered when the
    // day turns and every read in it re-settles then. See the header.
    if (CLOCK_HOOK.test(body)) continue;

    for (const hit of renderReads(src, scope.start, scope.end)) {
      const line = lineOf(hit.at);
      // The blanked line, not the raw one: a comment beside a `Date.now()`
      // explaining the day it used to compute must not be what convicts it.
      if (!FORMS_A_DAY.test(srcLines[line - 1] ?? '')) continue;
      if (marked(line)) continue;
      // `gymDay(Date.now(), zone) ?? isoDate(new Date())` is two bare reads on
      // one line and one defect; report the line once.
      if (already.has(line)) continue;
      already.add(line);
      found.push({
        key: `${rel}:render-body`, rel, line,
        text: rawLines[line - 1].trim().slice(0, 110),
        wrong: `a clock read in the render body of \`${scope.name}\`, turned into a calendar day — this component subscribes to no clock, and an expo-router tab (or an \`href: null\` screen) is mounted once and never torn down, so the day here is the day of the last state change`,
        right: 'useToday() from src/ui/today.ts for a day, useNow() for an instant — both re-render this component at local midnight and on every foreground, which is what makes a value in a render body true again.',
      });
    }
  }
}

/* Rule 3's empty-set guards, checked once the sweep is done. Two of them, and
 * they answer different questions: gate-floor asks whether the FILES are still
 * where the gate thinks they are, RENDER_SCOPE_FLOORS asks whether the parser
 * still recognises a component when it opens one. See the comment on
 * RENDER_SCOPE_FLOORS for why the second is iterated over its own keys rather
 * than over whatever the sweep happened to fill in. */
assertRootFloors('check:frozen-day (rule 3, render bodies)', perRenderRoot);
const bare = Object.entries(RENDER_SCOPE_FLOORS)
  .map(([root, floor]) => ({ root, floor, n: perRenderRootScopes.get(root) ?? 0 }))
  .filter((r) => r.n < r.floor);
if (bare.length) {
  console.error('check-frozen-day: rule 3 recognised almost no components in a root it names, so "no clock '
    + 'standing in a render body" would be a claim about code it never read.\n');
  for (const r of bare) console.error(`  ${r.root}: ${r.n} component or hook bod${r.n === 1 ? 'y' : 'ies'}, expected at least ${r.floor}`);
  console.error('\nEither a root has moved, or renderScopes() has stopped matching how components are '
    + 'declared here. Fix the parser, or change the number in RENDER_SCOPE_FLOORS with a reason.');
  process.exit(1);
}
const renderScopeCount = [...perRenderRootScopes.values()].reduce((a, b) => a + b, 0);

/* ── the ratchet ──────────────────────────────────────────────────────────── */

/* Keyed on the ratchet KEY rather than the path: rules 1 and 2 key on the file,
 * rule 3 on `<file>:render-body`, so clearing one kind in a file cannot buy
 * tolerance for the other. */
const byFile = new Map();
for (const h of found) {
  if (!byFile.has(h.key)) byFile.set(h.key, []);
  byFile.get(h.key).push(h);
}

const fresh = [];
for (const [key, hits] of byFile) {
  const allowed = KNOWN.get(key)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed, total: hits.length })));
}

const drifted = [];
for (const [key, entry] of KNOWN) {
  const n = byFile.get(key)?.length ?? 0;
  if (n < entry.count) drifted.push({ rel: key, was: entry.count, now: n, fix: entry.fix });
}

if (fresh.length) {
  const found = fresh;
  found.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${found.length} clock${found.length === 1 ? '' : 's'} that stopped when the screen opened:\n`);
  for (const h of found) {
    if (h.allowed) console.error(`  (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: ${h.wrong}`);
    console.error(`    right: ${h.right}\n`);
  }
  console.error('A coach whose public liability insurance expired on Monday read as covered, in');
  console.error('the green, on Wednesday, because the screen judging it was still asking Sunday\'s');
  console.error('question. src/ui/today.ts is the answer and its header argues the whole case.\n');
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
console.log(`check-frozen-day — ok, ${files.length} files (${renderScopeCount} component and hook bodies under `
  + `${RENDER_ROOTS.join('/')} read for rule 3); no new clock frozen at mount, and none standing in a render body`
  + `${backlog ? `; ${backlog} known and ratcheted` : ''}`);
