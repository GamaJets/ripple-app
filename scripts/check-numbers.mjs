// Figures over three digits carry a thousands separator.
//
// Reported as "when you have more than 3 digits in a number add a comma."
// Half the screens called toLocaleString and half printed the raw number, so
// the same day's calories read 2,860 on the Meals hero and 2860 four lines
// down. A sweep fixes today; this stops the next figure being added raw.
//
// ── What it looks for ─────────────────────────────────────────────────────
//
// A value rendered into the UI whose NAME says it can pass a thousand —
// calories, volume, steps, revenue, a total — with no formatter anywhere on
// the line. It reads names rather than values because a value's range is not
// in the source: `kcal` is a number that reaches four digits in a weekly
// total and three in a snack, and the honest rule is that a field which can
// is formatted.
//
// ── What it deliberately does not flag ────────────────────────────────────
//
// Anything already passing through num(), num1() or toLocaleString on the same
// line. A <TextInput value=…>, where a separator would be typed back into the
// parser as a digit. And a name on the ignore list below, each with the reason
// it cannot exceed 999 written next to it — because "it is small" is a claim
// that needs to survive somebody changing the field. Or a site carrying a
// `numbers-ok: <why>` marker, which is the same claim made where a NAME cannot
// carry it: see EXCUSE below.
//
// ── why this reads names and not TYPES, measured rather than assumed ───────
//
// The obvious upgrade is a type-informed rule over the existing tsconfig: "a
// numeric expression may not be interpolated into a template literal or a JSX
// child except through a known formatter". It was built as a probe and thrown
// away, and the numbers are the reason.
//
// Over app/, src/lib and src/ui, the TypeScript checker finds 2,395 template
// spans and JSX children whose type is numeric — 1,155 in app, 1,064 in src/lib,
// 176 in src/ui. A gate that opens with a 2,395-line baseline is not a gate.
//
// The offered narrowing is "expressions whose declaration contains a division
// or a known fractional producer", and it takes that to 221. That is a landable
// number and it is still the wrong 221, because the narrowing does not work:
//
//   · 56 of them are `Math.floor(...)`, `Math.round(...)`, `Math.trunc(...)` or
//     `Math.ceil(...)` AT THE INTERPOLATION — the rule flags a figure the line
//     itself has just made whole. `Math.floor(s / 60)` in timedSets.ts,
//     `Math.round(b / 1024)` in coachDocs.ts, `Math.trunc(abs / f)` in
//     coachMoney.ts.
//   · 120 more are a bare identifier — `mins`, `days`, `pct`, `limit`, `h`, `i`
//     — where nothing in the text says anything at all, and the declaration
//     upstream has a `/` in it because that is how you get minutes out of
//     milliseconds. `Math.min(topRange, lastReps + 1)` is a REP COUNT.
//
// So the type check answers a question next to the one that matters. TypeScript
// says `number`; nothing in this codebase says INTEGER, and whether a value can
// be fractional is not in the source text for a regex OR in the type for a
// checker. The thing that would make the rule work is a branded whole-number
// type returned by the rounding helpers, and that is a change to the codebase
// rather than a gate over it.
//
// Written down so the next sweep does not spend a night rediscovering it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

// The console renders the same kind of figure — a member count, a visit tally,
// a pass total — into the same kind of JSX, and a raw four-digit number is
// exactly as unreadable in a browser as on a phone. This rule is about the
// STRING a reader sees and nothing about React Native, so the console gets it.
//
// It is the console's own formatters that go in FORMATTED below, not the app's:
// `studio-web/lib/num.ts` argues at length why it cannot import src/lib/format
// — every function there asks `appLocale()`, a module-level latch seeded once,
// which in Next.js resolves on the server during render and again in the
// browser during hydration, on two machines with two locales. That is a silent
// hydration error. So the console has `num`, `num1` and `numUpTo` of its own,
// and `amount` in studio-web/lib/currency.ts for a gym-denominated figure.
//
// ── and src/lib, which is where most of the copy is actually built ─────────
//
// The list above walked the two trees that hold JSX and missed the tree that
// holds the SENTENCES. Report prose, notification bodies, export text and every
// "N of M" line in this app are assembled in src/lib and handed to a screen
// already spelled, so a four-digit figure written raw there is invisible to a
// gate that only reads `app` and `src/ui` — the screen it lands on shows one
// interpolated string and there is nothing on that line to flag.
//
// Widening to src/lib found twenty sites across thirteen files on the first
// run, which is the size a gate can be read at on the day it lands. Six were
// fixed. The rest are the interesting half, and they split three ways — see
// EXCUSE below, because the answer to most of them is NOT a formatter:
//
//   · A CONSOLE-SHARED module. `@lib/*` in studio-web resolves to `../src/lib/*`
//     and 106 modules under src/ are reachable that way, so the hydration
//     argument three paragraphs up applies INSIDE src/lib as well: a string
//     built by consoleSearch.ts, gymSetup.ts or interventions.ts is rendered by
//     Next.js, and `num()` from src/lib/format.ts would latch `appLocale()` on
//     the server pass and again in the browser. Those pages are all
//     'use client' and load their rows in an effect, so nothing reaches the
//     prerendered HTML today — which is a property of the call site and not of
//     the module, and is exactly the reasoning studio-web/lib/num.ts refused to
//     rely on when it duplicated the formatter rather than importing it. There
//     is no formatter a shared module may call, so those sites say so and stay.
//
//   · A SERVER-SIDE module. Thirteen modules under src/lib are imported by
//     supabase/functions, where `appLocale()` resolves to the container's
//     locale, which belongs to nobody. None of the twenty findings was in that
//     set, but the category is real and the next one will be: `npm run
//     check:functions` is what answers the question.
//
//   · A figure that genuinely cannot reach a thousand — sets in one exercise,
//     sessions in one pack, the six settings on a setup checklist. SMALL below
//     is keyed on the NAME, and inside src/lib the name is almost always the
//     bare local `total`, which means five different things in five files. So
//     the reason goes at the site instead.
const ROOTS = ['app', 'src/lib', 'src/ui', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];
const ROOT = process.cwd();

/** Field-name fragments whose values pass a thousand in normal use. */
const BIG = /(kcal|calorie|volume|steps|revenue|payroll|earnings|total[A-Z]|Total\b|grams|mg\b|ml\b)/i;

/** Names that match BIG but genuinely cannot exceed 999, and why. */
const SMALL = new Map([
  ['totalSteps', 'a step counter in an onboarding flow — 5 of them'],
  ['totalSlots', 'bookable slots in one day'],
  ['kcalIn', 'a TextInput draft, typed by a person'],
  ['setKcal', 'a setState function, not a figure'],
  ['setKcalIn', 'a setState function, not a figure'],
  ['kcalNote', 'a sentence built elsewhere, already formatted'],
  ['dayVolumeNote', 'a sentence from tonnageNote in src/lib/bodyweightSets.ts — it carries a count of sets, never a tonnage'],
  ['totalPct', 'a percentage'],
  ['sessions_total', 'the size of a session pack — 5, 10, 20'],
  ['CYCLE_KCAL', 'the fixed carb-cycling step, a constant under 300'],
  ['grams', 'already a formatted range label — "132–165 g" — not a number'],
  // Added when the console joined ROOTS. Both are the SIZE OF ONE BOOK rather
  // than a tally across the gym, which is the distinction that matters here:
  // `passesTotal` on studio-web/app/passes is how many passes the gym has ever
  // issued and IS formatted, while these two are what is printed on a single
  // one of them.
  ['usesTotal', 'visits on one gym pass — a 10- or 20-visit book, or a year of daily entry; never four digits'],
  ['packTotal', 'sessions in one coaching pack — 5, 10, 20, exactly as sessions_total above'],
  // Not "cannot reach 999" but "is not a number at all" — the second kind of
  // entry on this list, which `kcalNote`, `grams` and `setKcal` above already
  // are. `payrollMoney` in studio-web/app/close/page.tsx is `money()`'s output:
  // a string with a currency code on the front, grouped by `minorMoney` at the
  // point it was built. BIG matches it on the bare word `payroll`, so no name
  // that still says what it holds can get past that; the local was renamed from
  // `payrollTotal` anyway, because a name ending in Total reads as a figure and
  // that is the confusion this gate ran into.
  ['payrollMoney', 'a money() string built where the currency is known — already grouped, and a separator on a string is nothing'],
]);

// `numUpTo` and `amount` are the console's, and both group: `numUpTo` is
// `toLocaleString` with a decimal cap, `amount` goes through `money()` in
// src/lib/gymRecord.ts and so through `minorMoney`. Neither matched the
// alternation before — `numUpTo(` is not `num` followed by a bracket — so a
// figure the console HAD formatted would have been reported raw.
const FORMATTED = /\b(num|num1|numUpTo|amount|money|toLocaleString|toFixed|catalogueValue)\s*[(.]/;

/**
 * `numbers-ok: <why>` on the line, or in the run of comment lines above it.
 *
 * The same contract as `decimal-ok:` in check-decimals.mjs, `locale-ok:` in
 * check-locale.mjs and `grant-ok:` in check-grants.mjs: the reason IS the
 * marker, and a bare one with nothing after it does not count.
 *
 * It exists because SMALL above cannot hold what src/lib needs it to. SMALL is
 * keyed on the NAME, which works while a name is unique and descriptive —
 * `usesTotal` is visits on one gym pass wherever it appears. Inside src/lib the
 * name is nearly always the bare local `total`, and it is sets in one exercise
 * in setLadder.ts, sessions in one pack in sessionCredits.ts, the six items on a
 * setup checklist in gymSetup.ts and a count of imported roster rows in
 * rosterImport.ts — which is four digits and WAS a defect. One SMALL entry would
 * silence all four including the real one.
 *
 * The other thing it holds is the answer that is not a formatter at all: a
 * module the console imports, or one an edge function imports, where there is
 * no reader whose locale could be asked. Those sites are not fixable from
 * inside src/lib, and a gate whose only offered remedy would introduce a
 * hydration error has to let the site say so instead.
 */
const EXCUSE = /numbers-ok:\s*\S/;

/** A line that is nothing but comment. */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/**
 * Is this line excused — on itself, or anywhere in the unbroken run of comment
 * lines directly above it?
 *
 * The block rather than one line, because every reason worth writing down here
 * is longer than a line: three of the sites below need a paragraph about why a
 * console-shared module has no locale to spell in, and a rule that only read
 * `lines[i - 1]` would force that paragraph onto one 400-character line or push
 * the marker off the end of it. The run stops at the first line that is not a
 * comment, so a reason can only ever excuse the statement it sits on top of.
 */
function excused(lines, i) {
  if (EXCUSE.test(lines[i])) return true;
  for (let k = i - 1; k >= 0 && COMMENT_LINE.test(lines[k]); k--) {
    if (EXCUSE.test(lines[k])) return true;
  }
  return false;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const findings = [];
const perRoot = new Map();
for (const root of ROOTS) {
  const files = walk(join(ROOT, root));
  perRoot.set(root, files.length);
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (FORMATTED.test(line)) return;
      if (/<TextInput/.test(line)) return;
      if (excused(lines, i)) return;
      // {expr} in JSX text, and ${expr} in a template literal.
      //
      // A JSX ATTRIBUTE — prop={value} — passes a number on rather than
      // printing it, and the screen that finally shows it is where the
      // separator belongs. Matching those flagged every prop named after a
      // figure, which teaches people to silence the check rather than read it.
      const exprs = [...line.matchAll(/(=)?\$?\{([A-Za-z_$][\w.$]*)\}/g)]
        .filter((m) => m[1] !== '=')
        .map((m) => m[2]);
      for (const expr of exprs) {
        const leaf = expr.split('.').pop();
        if (!BIG.test(leaf)) continue;
        if (SMALL.has(leaf) || SMALL.has(expr)) continue;
        findings.push(`${relative(ROOT, file)}:${i + 1}  {${expr}} — a figure that can pass a thousand, rendered raw`);
      }
    });
  }
}

// A root that has moved, been renamed, or quietly stopped producing files,
// reported rather than covered for by the roots that remain — this gate had no
// empty-set guard of any kind before src/lib was added to it, and src/lib is
// two thirds of what it now reads. See scripts/gate-floor.mjs.
//
// What it does NOT catch, stated because it was measured rather than assumed:
// a root DELETED from ROOTS above. `assertRootFloors` walks the counts it is
// handed, and a root nobody counted has no entry to be short. Deleting
// 'src/lib' from the array leaves this printing `numbers ok` over 401 unread
// files. A root MISTYPED there fails loudly (readdirSync throws ENOENT), and a
// root that shrinks past its floor fails here; a root removed on purpose is a
// diff a person has to read.
assertRootFloors('check:numbers', perRoot);

if (findings.length) {
  console.error(`${findings.length} figure(s) rendered without a thousands separator:\n`);
  for (const f of findings) console.error('  ' + f);
  console.error(`\nWrap it in num() from src/lib/format — or, in the console, num() from`);
  console.error('studio-web/lib/num.ts. If it genuinely cannot reach 999, add the name to SMALL');
  console.error(`in ${relative(ROOT, 'scripts/check-numbers.mjs')} with the reason.`);
  console.error('\nIf it is a module the CONSOLE or an EDGE FUNCTION imports, there is no reader');
  console.error('whose locale could be asked and no formatter you may call — `npm run check:functions`');
  console.error('says which. Write the reason as `numbers-ok: <why>`, on the line itself or');
  console.error('anywhere in the run of comment lines directly above it.');
  process.exit(1);
}
console.log('numbers ok — every four-digit-capable figure goes through a formatter');
