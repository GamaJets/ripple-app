#!/usr/bin/env node
// A component declared inside a render body, which React tears down and
// rebuilds on every single render.
//
// ── the bug, and what it cost ─────────────────────────────────────────────
//
// React decides whether an element is the SAME element as last time by
// comparing its type by identity. For a host element the type is the string
// `'View'`, which is stable. For a composite element the type is the function
// itself — and a function declared inside another function's body is a NEW
// function every time that body runs. So:
//
//     export default function InjuryDoc() {
//       const [note, setNote] = useState('');
//       const Proposal = ({ cand }) => (            // ← new function each render
//         <Card>
//           …
//           <TextInput value={note} onChangeText={setNote} />
//         </Card>
//       );
//       return <>{cands.map((c) => <Proposal key={c.id} cand={c} />)}</>;
//     }
//
// `<Proposal/>` on render N and `<Proposal/>` on render N+1 have different
// types, so React does not reconcile them. It unmounts the whole subtree,
// throws the host views away, and mounts a fresh one. State inside it is lost,
// the native view is destroyed, and anything the OS was holding a reference to
// goes with it.
//
// Two defects on this project, found in one night, were both exactly this:
//
//   · app/(client)/injury-doc.tsx — `Proposal` held the Note `TextInput`, the
//     one field on that screen a member has to write themselves. `setNote` on
//     every keystroke re-rendered the screen, which rebuilt `Proposal`, which
//     destroyed and recreated the native text field. The keyboard dismissed and
//     the caret was lost AFTER EVERY CHARACTER. The member could not type a
//     sentence about their own injury.
//   · app/(client)/injuries.tsx — `Row`'s outer `View` is `accessible` with a
//     composed label, which is one accessibility element. Remounting it moves
//     VoiceOver focus, so every state change on the screen re-announced each
//     injury from the top. A screen reader user could not get to the end of a
//     list that kept starting over.
//
// Both were fixed the same way and the fix is at the bottom of this header.
//
// ── why a gate ────────────────────────────────────────────────────────────
//
// Because this project had already learned the rule, written it down, and
// broken it twice anyway. app/(client)/report.tsx:475 carries it in prose:
//
//     Written as a plain call and not a component so it does not remount the
//     text — and therefore does not interrupt a screen reader — every time
//     this screen redraws.
//
// That comment is correct, it is well argued, and it sits in ONE file where
// nothing enforces it. A rule that lives in a comment protects the file the
// comment is in. When this gate was written, seventeen more sites in this tree
// were the shape it warns about. A gate is what turns a sentence somebody wrote
// once into a thing the build knows.
//
// ── and the count in that sentence is now wrong, which is the point ───────
//
// This paragraph said "Seventeen more sites in this tree are the shape it warns
// about" as a statement about today, and it kept saying it while three lanes
// took the backlog apart underneath it. SIX are left, in THREE files, and they
// are the whole of KNOWN below — the number in the header is not a second
// source of truth, KNOWN is, and this sentence exists so a reader who has just
// read "seventeen" upstairs knows which of the two to believe. The seventeen
// was true on 14 September 2026 and is kept rather than overwritten because it
// is what makes the ratchet legible: the backlog has moved 17 → 12 → 6 and has
// never moved the other way, and that is the only claim this gate is making
// about the count. Read KNOWN, not a paragraph.
//
// ── what this matches, and why each condition is load-bearing ─────────────
//
// All four have to hold. The gate parses each file with the TypeScript
// compiler and looks for:
//
//   1. a function declared INSIDE another function's body — `const X = …`,
//      `function X() {}`, arrow or expression, whose nearest enclosing
//      function is not the module.
//   2. whose name is Capitalised.
//   3. which returns JSX.
//   4. AND which is used as `<X …/>` somewhere inside that same enclosing
//      body.
//
// Drop any one of them and the gate is either useless or wrong:
//
//   · Capitalised AND used as an element is the whole of what makes React
//     treat it as a component TYPE. A lowercase helper invoked as
//     `proposal(cand)` returns an element that React splices into the parent's
//     children; the parent's type never changes, nothing remounts, and the
//     member keeps their caret. That form is THE FIX and must never be
//     reported. It is why condition 2 is about the case of the name and not
//     about whether the thing returns JSX.
//   · Declared inside the body is the defect. The identical component at
//     module scope is correct, is the normal way to write React, and this tree
//     has hundreds. A gate that flagged those would be switched off inside a
//     day and would take the real rule with it.
//   · A function returning JSX that is only ever CALLED — `{narrativeBlock(0)}`,
//     `{row(inj, first)}` — is fine whatever its case, because a call site is
//     not a type. Condition 4 is what lets the fixed files pass.
//
// Nothing here requires the enclosing function to be a React component. It
// does not need to be: any function that builds JSX and is invoked more than
// once hands out a fresh type each time it runs, and a factory called once per
// render is a render body by another name. Requiring "looks like a component"
// would mean guessing, and the guess buys nothing.
//
// ── what it deliberately cannot see ───────────────────────────────────────
//
// Stated plainly, because a gate that overclaims is worse than one that admits
// its edges — check:currency-copies and check:mount-zone both carry the same
// section, and a reader deciding whether this rule is covered needs to know
// where it stops.
//
//   • A component passed as a PROP rather than written as an element:
//     `renderItem={Row}`, `ListEmptyComponent={Empty}`, `component={Screen}`.
//     Whether a new identity there remounts anything depends on what the
//     receiving component does with it — FlatList's `renderItem` is called,
//     not mounted, so it is harmless; a navigator's `component` is mounted,
//     so it is not. Condition 4 sees none of them, and telling the two apart
//     needs to know the callee, which this gate does not.
//   • A component built by a FACTORY — `const X = makeChip(tone)` — or picked
//     out of a map, `const Icon = ICONS[kind]`. The initialiser is a call or
//     an index, not a function literal, so condition 1 misses it. These are
//     often correct (the map case usually resolves to a stable module-scope
//     component) and sometimes not.
//   • A component declared in a HOOK and returned to the caller. The
//     declaration is inside a function body, but the `<X/>` is in the screen,
//     not in the hook, so condition 4 does not hold and the gate stays quiet.
//     That is the honest limit of a per-function scope: following the value
//     out of the hook and into the screen is a cross-file dataflow this does
//     not do.
//   • A component wrapped at declaration — `const X = memo((p) => <V/>)`,
//     `const X = forwardRef(…)`. Same miss as the factory case, for the same
//     reason, and the two wrappers differ: `memo(…)` evaluated in a render
//     body is a new type every render and IS this defect, while
//     `useMemo(() => …, [])` is stable by construction and is one of the
//     correct ways out. Matching the initialiser shape well enough to tell
//     those apart is a second rule, and a second rule is a second gate.
//   • Anything outside .tsx. JSX lives only there. The .ts files under these
//     roots are walked and parsed so the per-root floors mean something, but
//     no .ts file can produce a hit.
//   • Whether a given remount actually HURTS. The gate reports what a subtree
//     holds — a `TextInput`, an `accessible` View — because those are the two
//     that cost a member something here, but a remounting subtree of static
//     `Text` is still a full teardown on every keystroke and is still on the
//     list.
//
// ── what to do instead ────────────────────────────────────────────────────
//
// Lane 95 fixed both sites the same way, and it is a small edit:
//
//   1. Rename to lowercase and call it. `const Proposal = ({ cand }) => (…)`
//      used as `<Proposal cand={c} />` becomes `const proposal = (cand) => (…)`
//      used as `{proposal(c)}`. The body does not otherwise change; it already
//      closes over the render body's state, which is why it was written there.
//   2. Move `key` onto the returned element. `<Proposal key={c.id} …/>` put the
//      key on the element; a plain call cannot take one, so the key belongs on
//      the outermost element the function RETURNS — `<Card key={cand.id} …>`.
//      Forgetting this is the one way to break the conversion, and React's
//      warning for it is easy to miss on a device.
//   3. Or lift it to module scope, if it does not need the render body's
//      closure. Pass what it used as props. This is the better answer for
//      anything reused across screens.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// There is a real case for a component declared in a body: one whose identity
// SHOULD change, because a remount is what you want — a form that must reset
// when the subject changes, say. It is rare and it needs to be argued, so mark
// the declaration line, or the run of comment lines immediately above it:
//
//     // remount-ok: this is keyed to the client and a remount is the reset —
//     // carrying the draft across two different people is the bug
//
// A bare marker does nothing; the sentence after the colon is required, same
// as `utc-day-ok:` in check-utc-day.mjs and `rtl-ok:` in check-rtl.mjs. What
// it is for is a reviewer reading one line and being able to tell whether the
// author knew the subtree gets destroyed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere a React component is written. The web console is included for
 *  the reason check-frozen-hook gives — it is React too, its pages are left
 *  open on a front desk, and the identity rule is the same in Next.js. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── this is a ratchet, not an ignore list ─────────────────────────────────
 *
 * The mechanism `KNOWN` sets out in check-dead-exports.mjs and check-utc-day
 * .mjs: a file listed at 2 fails the build at 3, so the backlog can shrink and
 * can never grow.
 *
 * A count that has DROPPED prints and passes, rather than failing. That is
 * check-frozen-hook.mjs's variation and it is right here for its reason: every
 * entry below is in another lane's territory, several of these files are being
 * edited tonight, and failing somebody's build for doing the work is how a
 * gate gets a `--force` written next to it. Lower the number when you see the
 * line.
 *
 * ── what the six are ──────────────────────────────────────────────────────
 *
 * Read this section as a log and not as a census. It has been headed "what the
 * twelve are" while holding three entries worth six sites, because each lane
 * that cleared a file edited the Map and left the paragraph — which is the same
 * failure the header upstairs had at "seventeen", one storey down. The history
 * is kept and the current line is stated last, so the next lane can see which
 * sentence is about today:
 *
 *   17 — counted 14 September 2026, after Lane 95's two fixes.
 *   12 — after Lane 124 cleared the five accessibility sites listed below.
 *    6 — three files, and the entries in the Map are the whole of it. Where
 *        this paragraph and the Map disagree, the Map is right.
 *
 * Seventeen were counted on 14 September 2026, after Lane 95 fixed
 * injury-doc.tsx and injuries.tsx, which is why neither is on this list. None
 * of the seventeen held a `TextInput`, so none of them was the caret-losing
 * failure — that one is fixed and this gate exists to keep it fixed.
 *
 * Five of the seventeen were the ACCESSIBILITY half of that backlog, and Lane
 * 124 fixed all five on the same day, which took the list from seventeen to
 * twelve:
 *
 *   · src/ui/OwnRecordsPanel.tsx `Row` — the only one whose root was an
 *     `accessible` View with a composed label, i.e. the injuries.tsx failure
 *     exactly: one element to VoiceOver, re-announced from the top on every
 *     render. Now `row(key, {…})`, with the `key` on the returned View.
 *   · app/(client)/reminders.tsx `DayPicker` — seven `role="checkbox"`
 *     Pressables. Now `dayPicker(days, onToggle, label)`; nothing maps over the
 *     picker, so no `key` moved.
 *   · app/(client)/onboarding.tsx `Chip` (role="radio") and `Pill`
 *     (role="button") — now `chip(key, {…})` and `pill(key, {…})`, with the
 *     `key` on the returned Pressable for the three `.map` call sites.
 *   · app/(trainer)/my-training.tsx `EntryRow` (role="button") — now
 *     `entryRow(key, e)`, used in two `.map`s, `key` on the returned View.
 *
 * What is left is the six below, in three files — all of them other lanes'.
 * None holds a `TextInput` and none has an `accessible` root, so neither of the
 * two failures in the header is live anywhere in this tree; the gate is holding
 * them fixed rather than reporting them.
 *
 * The wrapper sentence here named four files as carrying the remaining
 * `accessibilityRole`/`accessibilityLabel` — coach.tsx, growth.tsx,
 * payments.tsx and client-intake.tsx. Checked against the scan rather than
 * against the paragraph: ONE of the six carries either attribute, and it is
 * `Pick` in app/(trainer)/payments.tsx (`role="button"`). app/(owner)/growth.tsx
 * has no hit at all any more; coach.tsx's `Bullets`/`Disclosure` and
 * client-intake.tsx's `Line` are unlabelled static text. A remount still costs
 * them their whole subtree — that is why they are on the list — but only
 * `Pick` moves a screen reader's cursor when it goes.
 */
const KNOWN = new Map([
  ['app/(client)/coach.tsx', { count: 2, fix: '`Bullets` and `Disclosure`, and `Disclosure` renders `<Bullets/>` — two nested types rebuilt together. Both are static text; lift them to module scope and pass `t`.' }],
  ['app/(trainer)/client-intake.tsx', { count: 1, fix: '`Line` — a label/value pair used a dozen times in one screen. Lift to module scope.' }],
  ['app/(trainer)/payments.tsx', { count: 3, fix: '`Pick` (Pressable, role="button"), `Pots` and `Made`. This screen is 2,900 lines and re-renders on every figure that lands, so all three are rebuilt repeatedly. Convert to calls.' }],
]);

/** A test file. A test for this rule has to be able to WRITE the broken shape. */
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
 * Does a marker apply to `line` (1-based)?
 *
 * On the line itself, or anywhere in the unbroken run of comment and blank
 * lines immediately above it. It has to be allowed above the line because a
 * `//` inside JSX renders as two slashes on somebody's screen, and it is a RUN
 * rather than a window of N lines so an annotation cannot drift down and
 * quietly excuse the declaration after the one it was written for.
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

/* ── the four conditions, on the syntax tree ───────────────────────────────
 *
 * A parser and not a regex, because every condition here is structural. "Is
 * this declaration inside another function's body" and "is this name used as a
 * JSX tag in that same body" are questions about nesting, and a regex that
 * answered them by counting braces would be wrong on the first file with a
 * template literal in it. The compiler is already a devDependency and two
 * other gates in this directory parse with it.
 */

const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
  || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

const isJsxNode = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);

/**
 * Does this expression evaluate to JSX?
 *
 * A subtree search that stops at every nested function boundary. Stopping
 * matters: `return useCallback(() => <Row/>, [])` returns a FUNCTION, not JSX,
 * and a search that descended into the arrow would call it a component. Not
 * stopping would also make `renderItem={() => <X/>}` inside a returned element
 * irrelevant — but the returned element is found first anyway.
 */
function yieldsJsx(node) {
  let hit = false;
  (function go(n) {
    if (hit) return;
    if (isJsxNode(n)) { hit = true; return; }
    if (n !== node && isFn(n)) return;
    ts.forEachChild(n, go);
  })(node);
  return hit;
}

/** Condition 3: the function returns JSX — as a concise arrow body, or from a
 *  `return` belonging to this function rather than to one nested inside it. */
function returnsJsx(fn) {
  const body = fn.body;
  if (!body) return false;
  if (!ts.isBlock(body)) return yieldsJsx(body);
  let hit = false;
  (function go(n) {
    if (hit) return;
    if (n !== body && isFn(n)) return;
    if (ts.isReturnStatement(n) && n.expression && yieldsJsx(n.expression)) { hit = true; return; }
    ts.forEachChild(n, go);
  })(body);
  return hit;
}

/**
 * Condition 4: `<name …/>` somewhere in `scope`.
 *
 * The tag has to be a bare Identifier. `<Foo.Bar/>` is a member access, whose
 * type is re-read from the object on every render anyway, and it is never the
 * shape this gate is about. Returns the first use, for the message.
 */
function usedAsElement(scope, name) {
  let hit = null;
  (function go(n) {
    if (hit) return;
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
      && ts.isIdentifier(n.tagName) && n.tagName.text === name) { hit = n; return; }
    ts.forEachChild(n, go);
  })(scope);
  return hit;
}

/** What the subtree HOLDS — the two things that turned this from a wasted
 *  render into a member unable to use the screen. */
function whatItHolds(decl, sf) {
  let textInput = false, accessible = false, labelled = false;
  (function go(n) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (/(^|\.)TextInput$/.test(n.tagName.getText(sf))) textInput = true;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const an = a.name.getText(sf);
        if (an === 'accessible') accessible = true;
        if (an === 'accessibilityLabel' || an === 'accessibilityRole') labelled = true;
      }
    }
    ts.forEachChild(n, go);
  })(decl);
  return { textInput, accessible, labelled };
}

/** Every capitalised inner function used as an element in its own enclosing
 *  body, with the line of the declaration and of its first use. */
function scan(rel, src, kind) {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out = [];
  const stack = [];
  (function go(n) {
    let cand = null;
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) {
      cand = { name: n.name.text, fn: n, decl: n };
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text)
      && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      cand = { name: n.name.text, fn: n.initializer, decl: n };
    }
    if (cand && stack.length && returnsJsx(cand.fn)) {
      const outer = stack[stack.length - 1];
      const use = usedAsElement(outer, cand.name);
      if (use) {
        out.push({
          name: cand.name,
          line: lineOf(cand.decl),
          useLine: lineOf(use),
          outerLine: lineOf(outer),
          holds: whatItHolds(cand.decl, sf),
        });
      }
    }
    if (isFn(n)) { stack.push(n); ts.forEachChild(n, go); stack.pop(); } else ts.forEachChild(n, go);
  })(sf);
  return out;
}

/* ── the walk ─────────────────────────────────────────────────────────────── */

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
assertRootFloors('check:remount', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check: it reports "ok" and a count.
if (files.length < 150) {
  console.error(`check-remount: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

// And the same guard one level down, on the files that can actually hold a
// hit. JSX is only in .tsx; if that number collapses, the scan is looking at a
// tree with no screens in it and its "ok" would be a claim about nothing.
const tsxCount = files.filter((f) => f.endsWith('.tsx')).length;
if (tsxCount < 100) {
  console.error(`check-remount: found ${files.length} source files but only ${tsxCount} .tsx — JSX lives only in .tsx, so this scan would be reading almost no components. Refusing to pass.`);
  process.exit(1);
}

const byFile = new Map();
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  const hits = scan(rel, src, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!hits.length) continue;
  const lines = src.split('\n');
  const live = hits.filter((h) => !markedAbove(lines, h.line, /remount-ok:\s*\S/));
  if (live.length) byFile.set(rel, live);
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const fresh = [];
for (const [rel, hits] of byFile) {
  const allowed = KNOWN.get(rel)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, rel, allowed, now: hits.length })));
}

const dropped = [];
for (const [rel, entry] of KNOWN) {
  const n = byFile.get(rel)?.length ?? 0;
  if (n < entry.count) dropped.push({ rel, was: entry.count, now: n });
}

if (fresh.length) {
  console.error(`\n${fresh.length} component${fresh.length === 1 ? '' : 's'} declared inside a render body and used as an element, so React rebuilds the subtree on every render:\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.name} is declared in the body of the function starting at line ${h.outerLine}, returns JSX, and is used as <${h.name} …/> at line ${h.useLine}.`);
    console.error(`    wrong: the element's TYPE is this function, and the function is rebuilt every render, so the subtree is unmounted and remounted rather than reconciled.`);
    if (h.holds.textInput) {
      console.error('    AND IT HOLDS A TextInput. This is the injury-doc.tsx failure exactly: the native');
      console.error('    field is destroyed on every keystroke, so the keyboard dismisses and the caret is lost.');
    }
    if (h.holds.accessible) {
      console.error('    AND ITS ROOT IS AN `accessible` VIEW. This is the injuries.tsx failure exactly: one');
      console.error('    accessibility element, remounted, so VoiceOver re-announces it from the top.');
    } else if (h.holds.labelled) {
      console.error('    It carries accessibilityLabel/Role, so a remount moves the screen reader cursor with it.');
    }
    console.error(`    right: rename it lowercase and CALL it — \`${h.name[0].toLowerCase()}${h.name.slice(1)}(…)\` — moving any \`key\` onto the element it returns; or lift it to module scope and pass what it closed over as props.`);
    if (h.allowed) console.error(`    (this file is on the ratchet at ${h.allowed}; it now has ${h.now})`);
    console.error('');
  }
  console.error('A member could not type a sentence about their own injury, because the field was');
  console.error('thrown away after every character. app/(client)/report.tsx:475 had already written');
  console.error('this rule down in a comment, and two files broke it anyway. If a remount is');
  console.error('honestly what you want here, say so on the declaration or in the comment run');
  console.error('above it: `remount-ok: <why the subtree should be destroyed>`.\n');
  process.exit(1);
}

if (dropped.length) {
  for (const d of dropped) {
    console.error(`check-remount: ${d.rel} is ratcheted at ${d.was} and now has ${d.now}. ${d.now === 0 ? 'Delete the entry.' : `Lower the count to ${d.now}.`}`);
  }
  console.error('');
}

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(`check-remount — ok, ${files.length} files (${tsxCount} .tsx); no new components declared in a render body${backlog ? `, ${backlog} known and ratcheted` : ''}`);
